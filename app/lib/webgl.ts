/**
 * WebGL is a fingerprinting surface, so the privacy-minded people this product
 * is built for often switch it off, and Tor Browser blocks it by default. In
 * those browsers three.js throws while constructing a renderer.
 *
 * Every visual in this app is decoration over a contract that does not need it,
 * so a missing WebGL context must never reach React. If it does, the boundary
 * unmounts the tree and takes the check-in button with it — which would mean a
 * privacy setting could stop an owner resetting the timer on their own vault.
 *
 * This lives in one place because it previously did not: the guard was written
 * inline in one component and silently missing from another that used the same
 * constructor. Call sites should treat null as "carry on without a canvas".
 */
export function tryCreateRenderer<T>(create: () => T): T | null {
  try {
    return create();
  } catch (error) {
    // Loud enough for a developer, harmless for the person using the app.
    console.warn(
      "Mortal Vault: WebGL is unavailable, continuing without it.",
      error,
    );
    return null;
  }
}
