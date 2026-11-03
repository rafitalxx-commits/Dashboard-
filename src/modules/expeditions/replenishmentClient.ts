import type { ReplenishmentItem } from "../../../backend/expeditionReplenishment/service";
export type { ReplenishmentItem };
const endpoint = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/expeditions/replenishment`;
async function read<T>(response: Response): Promise<T> {
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message || "No se pudo consultar la reposición");
  return payload as T;
}
export const replenishmentClient = {
  async list() { return read<{ items: ReplenishmentItem[]; previewCapturedAt?: string }>(await fetch(endpoint)); },
  async images(ids: number[]) {
    const result = await read<Record<string, string>>(await fetch(`${endpoint}/images?ids=${ids.join(",")}`));
    return Object.fromEntries(Object.entries(result).map(([id, value]) => [id, /^(data:|https?:)/.test(value) ? value : `data:image/png;base64,${value}`]));
  },
  async transfer(input: { productId: number; fromCode: string; toCode: string; quantity: number; requestId: string }) {
    return read<{ items: ReplenishmentItem[] }>(await fetch(`${endpoint}/transfer`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
    }));
  },
};
