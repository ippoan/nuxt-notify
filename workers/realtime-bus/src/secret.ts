// SOURCE-MIRROR: ippoan/auth-worker:src/lib/secret.ts
//
// Generic CF Secrets Store binding resolver。
// `[[secrets_store_secrets]]` binding は production では `{ get(): Promise<string> }`
// (`SecretsStoreSecret`) として注入されるが、vitest / `wrangler dev` は plain string を
// 渡す。両形態を `string | null` に正規化し、呼び出し側は `if (!value)` の 1 分岐で
// fail-closed に扱う (string 直叩きは "[object Object]" が外部に流れる実害の元、
// Refs ippoan/auth-worker#206)。

export type SecretBinding = string | SecretsStoreSecret | undefined;

export async function resolveSecret(
  binding: SecretBinding,
): Promise<string | null> {
  if (!binding) return null;
  if (typeof binding === "string") return binding;
  try {
    const value = await binding.get();
    return value || null;
  } catch {
    return null;
  }
}
