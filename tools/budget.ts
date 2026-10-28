export function assessBudget(cpu: number[], gpu: number[], supported: boolean) {
  const valid = (values: number[]) =>
    values.length > 0 && values.every((n) => Number.isFinite(n) && n >= 0 && n <= 16.6);
  return {
    pass: supported && valid(cpu) && valid(gpu),
    targetMs: 16.6,
    interpretation:
      "Every measured warm callback and GPU sample must be <=16.6ms; finite lab sample only, not universal guarantee.",
    cpuOverruns: cpu.filter((n) => n > 16.6).length,
    gpuOverruns: gpu.filter((n) => n > 16.6).length,
  };
}
