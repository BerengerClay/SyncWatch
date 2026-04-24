/**
 * SyncWatch - Synchronization Helpers
 * Logic extracted from SyncEngine to maintain a clean React component.
 */

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

// --- SYNC CORE LOGIC ---

/**
 * Calculates the incremental difference between two states based on synchronization rules.
 */
export const getIncrementalDiff = (
  newObj: any,
  oldObj: any,
  rules: any,
  currentPath = "",
): any => {
  const patch: any = {};
  let hasChanged = false;
  const currentOld = oldObj || {};

  for (const key in newObj) {
    const path = currentPath ? `${currentPath}.${key}` : key;
    const valNew = newObj[key];
    const valOld = currentOld[key];

    // 0. Protection des données ignorées (Traitement local uniquement)
    if (rules && rules[path]?.type === "IGNORED") continue;

    // 1. Protection des données continues (Smart Detect)
    if (rules && rules[path]?.type === "CONTINUOUS") {
      const threshold = 0.00005; //rules[path].driftThreshold || 2.0;
      // On ne sync que si l'écart est supérieur au threshold (Jump manuel)
      if (Math.abs(valNew - valOld) < threshold) continue;
    }

    // 2. CAS DES TABLEAUX (C'est ici qu'on règle ton bug Youtube !)
    if (Array.isArray(valNew) && Array.isArray(valOld)) {
      // On compare le contenu, pas l'adresse mémoire
      if (JSON.stringify(valNew) !== JSON.stringify(valOld)) {
        patch[key] = valNew;
        hasChanged = true;
      }
      continue; // On passe à la clé suivante
    }

    // 3. CAS DES OBJETS (Récursivité)
    if (valNew !== null && typeof valNew === "object") {
      const subPatch = getIncrementalDiff(valNew, valOld, rules, path);
      if (subPatch) {
        patch[key] = subPatch;
        hasChanged = true;
      }
    }
    // 4. CAS DES VALEURS SIMPLES (String, Number, Boolean)
    else if (valNew !== valOld) {
      patch[key] = valNew;
      hasChanged = true;
    }
  }
  return hasChanged ? patch : null;
};

/**
 * Filters the full state to only include necessary heartbeat data (Continuous fields that are active).
 */
export const buildHeartbeatPayload = (fullState: any, rules: any) => {
  const minimalistData: any = {};
  if (!rules) return minimalistData;

  Object.keys(rules).forEach((path) => {
    const rule = rules[path];
    if (rule.type === "CONTINUOUS") {
      let isActive = true;
      if (rule.activeIfKey) {
        const conditionValue = getValue(fullState, rule.activeIfKey);
        isActive = rule.activeInverted ? !conditionValue : !!conditionValue;
      }
      if (isActive) {
        const val = getValue(fullState, path);
        if (val !== undefined && val !== null) {
          setValue(minimalistData, path, val);
        }
      }
    }
  });
  return minimalistData;
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
  if (!serverTs || !rules) return patch;

  const nowSynced = Date.now() + clockOffset;
  const delay = (nowSynced - serverTs) / 1000;

  Object.keys(rules).forEach((path) => {
    const rule = rules[path];
    if (rule.type === "CONTINUOUS") {
      const valInPatch = getValue(patch, path);
      if (typeof valInPatch === "number") {
        // Determine speed (default to 1.0)
        const speed =
          rule.speedKey ?
            (getValue(patch, rule.speedKey) ??
            getValue(lastState, rule.speedKey) ??
            1)
          : 1;

        // Determine if it should be moving
        const active =
          rule.activeIfKey ?
            (getValue(patch, rule.activeIfKey) ??
            getValue(lastState, rule.activeIfKey))
          : true;
        const isActive = rule.activeInverted ? !active : !!active;

        if (isActive) {
          const interpolatedValue = valInPatch + delay * speed;
          setValue(patch, path, interpolatedValue);
        }
      }
    }
  });
  return patch;
};
