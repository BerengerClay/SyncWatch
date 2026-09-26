/**
 * SyncWatch - Synchronization Helpers
 * Fonctions pures de calcul de diffs, d'extrapolation temporelle et de manipulation d'états.
 */

// --- TYPES DE SYNCHRONISATION ---

export type SyncRuleType = "CONTINUOUS" | "DISCRETE" | "IGNORED";

export interface SyncRule {
  type: SyncRuleType;
  driftThreshold?: number;
  speedKey?: string;
  activeIfKey?: string;
  activeInverted?: boolean;
  blockingIfKey?: string;
  collective?: boolean;
  controllable?: boolean;
  ignoreIfKey?: string;
  hijacksPlayer?: boolean;
  reactions?: Record<string, Record<string, any>>;
}

// --- BASIC OBJECT HELPERS ---

export const getValue = (obj: any, path: string) =>
  path.split(".").reduce((acc, part) => acc && acc[part], obj);

export const setValue = (obj: any, path: string, value: any) => {
  const parts = path.split(".");
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!current[parts[i]]) current[parts[i]] = {};
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = value;
};

export const deepMerge = (target: any, source: any): any => {
  const isObject = (item: any) =>
    item && typeof item === "object" && !Array.isArray(item);
  if (!isObject(target) || !isObject(source)) return source;
  const output = { ...target };
  Object.keys(source).forEach((key) => {
    if (isObject(source[key])) {
      if (!(key in target)) output[key] = source[key];
      else output[key] = deepMerge(target[key], source[key]);
    } else {
      output[key] = source[key];
    }
  });
  return output;
};

// --- URL & MEDIA COMPARISON HELPERS ---

export const getCanonicalMediaId = (
  rawUrl: string | null | undefined,
): string | null => {
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl);

    // 1. YouTube (watch?v= ou /shorts/ ou youtu.be)
    if (parsed.hostname.includes("youtube.com")) {
      const v = parsed.searchParams.get("v");
      if (v) return `yt:${v}`;
      const shortsMatch = parsed.pathname.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
      if (shortsMatch) return `yt:${shortsMatch[1]}`;
    }
    if (parsed.hostname === "youtu.be") {
      const id = parsed.pathname.slice(1).split("?")[0];
      if (id) return `yt:${id}`;
    }

    // 2. Cas Général : Origine + Pathname (ignore les query params de tracking comme ?t= ou &utm=)
    return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, "");
  } catch {
    return rawUrl.trim();
  }
};

export const isSameMedia = (
  urlA: string | null | undefined,
  urlB: string | null | undefined,
): boolean => {
  const idA = getCanonicalMediaId(urlA);
  const idB = getCanonicalMediaId(urlB);
  if (!idA || !idB) return false;
  return idA === idB;
};

// --- SYNC CORE LOGIC ---

/**
 * Calculates the incremental difference between two states based on synchronization rules.
 */
export const getIncrementalDiff = (
  newObj: any,
  oldObj: any,
  rules: any,
  nowTs?: number,
  lastTs?: number,
  currentPath = "",
  rootNew = newObj,
  rootOld = oldObj,
): any => {
  const patch: any = {};
  let hasChanged = false;
  const currentOld = oldObj || {};

  for (const key in newObj) {
    const path = currentPath ? `${currentPath}.${key}` : key;
    const valNew = newObj[key];
    const valOld = currentOld[key];

    // 0. Protection des données ignorées dynamiquement ou statiquement
    if (rules && rules[path]) {
      if (rules[path].type === "IGNORED") continue;
      if (
        rules[path].ignoreIfKey &&
        getValue(rootNew, rules[path].ignoreIfKey)
      ) {
        continue;
      }
    }

    // 1. Protection des données continues (Smart Detect + Dead Reckoning)
    if (rules && rules[path]?.type === "CONTINUOUS") {
      const CAPTURE_THRESHOLD = rules[path]?.driftThreshold || 1.5; // Seuil de saut (Seek) en lecture
      let threshold = CAPTURE_THRESHOLD;

      if (nowTs && lastTs) {
        const speed =
          (rules[path].speedKey && getValue(rootNew, rules[path].speedKey)) ?? 1;

        const activeKey = rules[path].activeIfKey;
        const isActiveNow = activeKey ? !!getValue(rootNew, activeKey) : true;
        const wasActiveBefore =
          activeKey ? !!getValue(rootOld, activeKey) : true;

        const realIsActiveNow =
          rules[path].activeInverted ? !isActiveNow : isActiveNow;
        const realWasActiveBefore =
          rules[path].activeInverted ? !wasActiveBefore : wasActiveBefore;

        // Smart Threshold : On garde la précision chirurgicale en pause (1ms pour l'image par image)
        if (!realIsActiveNow && !realWasActiveBefore) {
          threshold = 0.001;
        }

        const deltaTimeSec = Math.max(0, (nowTs - lastTs) / 1000);
        const projectedValue =
          valOld + (realWasActiveBefore ? deltaTimeSec * speed : 0);
        const drift = Math.abs(valNew - projectedValue);

        // Si l'écart avec la prédiction est faible, c'est l'avancement naturel : ON IGNORE
        if (drift < threshold) continue;

        console.log(
          `[Sync] 🎯 Seek détecté ! Réel: ${valNew.toFixed(2)}s, Projeté: ${projectedValue.toFixed(
            2,
          )}s (Drift: ${drift.toFixed(2)}s > Seuil: ${threshold}s)`,
        );
      } else {
        // Fallback sans temps
        if (Math.abs(valNew - valOld) < threshold) continue;
      }
    }

    // 2. CAS DES TABLEAUX
    if (Array.isArray(valNew) && Array.isArray(valOld)) {
      if (JSON.stringify(valNew) !== JSON.stringify(valOld)) {
        patch[key] = valNew;
        hasChanged = true;
      }
      continue;
    }

    // 3. CAS DES OBJETS (Récursivité)
    if (valNew !== null && typeof valNew === "object") {
      const subPatch = getIncrementalDiff(
        valNew,
        valOld,
        rules,
        nowTs,
        lastTs,
        path,
        rootNew,
        rootOld,
      );
      if (subPatch) {
        patch[key] = subPatch;
        hasChanged = true;
      }
    }
    // 4. CAS DES VALEURS SIMPLES
    else if (valNew !== valOld) {
      patch[key] = valNew;
      hasChanged = true;
    }
  }
  return hasChanged ? patch : null;
};

/**
 * Compensates for network latency by projecting continuous fields based on their speed and activity state.
 */
export const interpolatePatch = (
  patch: any,
  rules: any,
  serverTs: number,
  clockOffset: number,
  lastState: any,
) => {
  if (!serverTs || !rules || !patch) return patch;

  const nowSynced = Date.now() + clockOffset;
  const delay = Math.max(0, (nowSynced - serverTs) / 1000);

  if (delay === 0) return patch;

  Object.keys(rules).forEach((path) => {
    const rule = rules[path];
    if (rule.type === "CONTINUOUS") {
      const valInPatch = getValue(patch, path);

      if (typeof valInPatch === "number") {
        const speed = rule.speedKey
          ? (getValue(patch, rule.speedKey) ??
            getValue(lastState, rule.speedKey) ??
            1.0)
          : 1.0;

        let isActive = rule.activeIfKey
          ? (getValue(patch, rule.activeIfKey) ??
            getValue(lastState, rule.activeIfKey) ??
            true)
          : true;

        if (rule.activeInverted) {
          isActive = !isActive;
        }

        if (isActive) {
          const interpolatedValue = valInPatch + delay * speed;
          setValue(patch, path, interpolatedValue);
        }
      }
    }
  });

  return patch;
};
