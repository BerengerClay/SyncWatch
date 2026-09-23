import { Room, SyncRule, WatchSession } from "../types/sync.js";

/**
 * Moteur mathématique et algorithmique de synchronisation.
 * Totalement agnostique des plugins : il applique les règles déclarées (CONTINUOUS, DISCRETE, IGNORED, Reactions).
 */

export const getValue = (obj: any, path: string): any =>
  path.split(".").reduce((acc, part) => acc && acc[part], obj);

export const setValue = (obj: any, path: string, value: any): void => {
  const parts = path.split(".");
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!current[parts[i]]) current[parts[i]] = {};
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = value;
};

export const deepMerge = (target: any, source: any): any => {
  if (!source) return target;
  if (!target) target = {};

  for (const key in source) {
    if (
      source[key] !== null &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key])
    ) {
      target[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
};

/**
 * Extrait l'identifiant canonique d'une vidéo/média pour ignorer les paramètres d'URL volatils
 * comme le timestamp (&t=15s) ou le tracking (&feature=shared).
 */
export const getCanonicalMediaId = (url: string | null | undefined): string | null => {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v) return `yt:${v}`;
      const shorts = u.pathname.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
      if (shorts) return `yt:${shorts[1]}`;
    }
    if (u.hostname === "youtu.be") {
      return `yt:${u.pathname.slice(1).split("?")[0]}`;
    }
    return `${u.origin}${u.pathname}`.replace(/\/+$/, "");
  } catch {
    return url.trim();
  }
};

export const isSameMedia = (urlA: string | null | undefined, urlB: string | null | undefined): boolean => {
  const idA = getCanonicalMediaId(urlA);
  const idB = getCanonicalMediaId(urlB);
  if (!idA || !idB) return false;
  return idA === idB;
};

/**
 * Calcule l'état projeté dans le temps d'une session (Dead-Reckoning).
 * Utilisé lorsqu'un nouveau membre rejoint ou demande un rattrapage.
 */
export const extrapolateSession = (
  session: WatchSession
): { state: WatchSession; ts: number } => {
  const now = Date.now();
  const timeDiff = (now - session.lastUpdate) / 1000;
  const extrapolatedState: WatchSession = JSON.parse(JSON.stringify(session));

  const rules = session.rules || {};

  Object.keys(rules).forEach((path) => {
    const rule = rules[path];
    if (rule.type === "CONTINUOUS") {
      const speed = rule.speedKey ? getValue(session.state, rule.speedKey) || 1 : 1;
      const active = rule.activeIfKey ? getValue(session.state, rule.activeIfKey) : true;
      const isRunning = rule.activeInverted ? !active : active;

      if (isRunning) {
        const baseValue = getValue(session.state, path);
        if (typeof baseValue === "number") {
          const extrapolated = baseValue + timeDiff * speed;
          setValue(extrapolatedState.state, path, extrapolated);
        }
      }
    }
  });

  extrapolatedState.lastUpdate = now;

  return { state: extrapolatedState, ts: now };
};

/**
 * Moteur de Réaction : applique les conséquences automatiques définies dans les règles
 * (ex: mise en pause collective pendant les pubs).
 */
export const processReactions = (
  data: any,
  rules: Record<string, SyncRule>,
  room: Room,
  sessionId: string,
  senderSocketId: string
): any => {
  const enhancedData = { ...data };
  if (!enhancedData.state) return enhancedData;

  const walk = (obj: any, parentPath = "") => {
    for (const key in obj) {
      const currentPath = parentPath ? `${parentPath}.${key}` : key;
      const val = obj[key];

      const rule = rules[currentPath];
      if (rule && rule.reactions) {
        let shouldApply = true;

        // Logique collective : on vérifie si d'autres membres de la session sont encore bloqués
        if (rule.collective && val === false) {
          const anyoneElseInSession = room.members.some((m) => {
            if (m.id === senderSocketId || m.sessionId !== sessionId) return false;
            if (!m.state) return false;
            const keys = currentPath.split(".");
            let current: any = m.state;
            for (const k of keys) {
              if (current && current[k] !== undefined) {
                current = current[k];
              } else {
                return false;
              }
            }
            return current === true;
          });
          if (anyoneElseInSession) shouldApply = false;
        }

        if (shouldApply) {
          const reaction = rule.reactions[String(val)];
          if (reaction) {
            Object.keys(reaction).forEach((targetPath) => {
              setValue(enhancedData.state, targetPath, reaction[targetPath]);
            });
          }
        }
      }

      if (val !== null && typeof val === "object" && !Array.isArray(val)) {
        walk(val, currentPath);
      }
    }
  };

  walk(data.state);
  return enhancedData;
};
