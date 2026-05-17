// Poisson PMF/CDF + Dixon-Coles low-score correction (rho).

export function poissonPMF(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  if (k < 0) return 0;
  // log-gamma para k! (k inteiro pequeno: factorial direto é OK e mais rápido)
  let fk = 1;
  for (let i = 2; i <= k; i++) fk *= i;
  return Math.exp(-lambda) * Math.pow(lambda, k) / fk;
}

export function poissonCDF(k, lambda) {
  let s = 0;
  for (let i = 0; i <= k; i++) s += poissonPMF(i, lambda);
  return s;
}

/** Probabilidade Poisson(>k) sem a CDF cheia, evitando 1-CDF para precisão. */
export function poissonTail(k, lambda) {
  return 1 - poissonCDF(k, lambda);
}

/**
 * Dixon-Coles tau: corrige baixo escore (0-0, 1-0, 0-1, 1-1).
 * rho típico = -0.10 a +0.10. Para over/under em totais, o efeito é pequeno.
 */
export function dcTau(x, y, lh, la, rho) {
  if (rho === 0) return 1;
  if (x === 0 && y === 0) return 1 - lh * la * rho;
  if (x === 0 && y === 1) return 1 + lh * rho;
  if (x === 1 && y === 0) return 1 + la * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}

/**
 * Distribuição conjunta de placar até maxGoals, com correção DC.
 * Retorna matriz [maxGoals+1][maxGoals+1] de probabilidades.
 */
export function scoreMatrix(lambdaHome, lambdaAway, { maxGoals = 8, rho = -0.05 } = {}) {
  const M = maxGoals + 1;
  const m = Array.from({ length: M }, () => new Array(M).fill(0));
  let sum = 0;
  for (let i = 0; i < M; i++) {
    const ph = poissonPMF(i, lambdaHome);
    for (let j = 0; j < M; j++) {
      const pa = poissonPMF(j, lambdaAway);
      const tau = dcTau(i, j, lambdaHome, lambdaAway, rho);
      m[i][j] = ph * pa * tau;
      sum += m[i][j];
    }
  }
  // Renormaliza para garantir soma 1 (DC quebra ligeiramente).
  if (sum > 0 && Math.abs(sum - 1) > 1e-9) {
    for (let i = 0; i < M; i++) for (let j = 0; j < M; j++) m[i][j] /= sum;
  }
  return m;
}
