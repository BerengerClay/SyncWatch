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
 * Vérifie si deux URLs pointent vers le même média.
 * La canonicalisation (retrait des paramètres volatils) est déléguée aux plugins clients (ex: getCurrentUrl).
 * Le moteur serveur reste ainsi 100% agnostique.
 */
export const isSameMedia = (urlA: string | null | undefined, urlB: string | null | undefined): boolean => {
  if (!urlA || !urlB) return false;
  return urlA.trim() === urlB.trim();
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
      if (rule.ignoreIfKey && getValue(session.state, rule.ignoreIfKey)) return;
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
  fullSessionState: any,
  rules: Record<string, SyncRule>,
  room: Room,
  sessionId: string,
  senderSocketId: string
): any => {
  const enhancedData = { ...data };
  if (data.state) {
    enhancedData.state = JSON.parse(JSON.stringify(data.state));
  }
  
  // On simule l'état complet après application du patch
  const simulatedState = { ...(fullSessionState || {}), ...(data.state || {}) };

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
          // Les réactions "true" agissent comme des contraintes continues (ex: forcer la pause pendant la pub).
          // Les réactions "false" n'agissent que comme des déclencheurs (ex: relancer la lecture à la fin de la pub).
          // On n'applique donc une réaction "false" QUE si la clé a réellement changé dans ce patch !
          const isKeyInPatch = data.state && getValue(data.state, currentPath) !== undefined;
          
          if (val === false && !isKeyInPatch) {
            // On ignore la réaction passive
          } else {
            const reaction = rule.reactions[String(val)];
            if (reaction) {
              Object.keys(reaction).forEach((targetPath) => {
                if (!enhancedData.state) enhancedData.state = {};
                setValue(enhancedData.state, targetPath, reaction[targetPath]);
              });
            }
          }
        }
      }

      if (val !== null && typeof val === "object" && !Array.isArray(val)) {
        walk(val, currentPath);
      }
    }
  };

  walk(simulatedState);
  return enhancedData;
};
