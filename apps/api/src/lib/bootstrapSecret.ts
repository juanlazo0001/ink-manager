const secret = process.env.BOOTSTRAP_SECRET;

if (!secret) {
  throw new Error("BOOTSTRAP_SECRET is not set");
}

export const BOOTSTRAP_SECRET = secret;
