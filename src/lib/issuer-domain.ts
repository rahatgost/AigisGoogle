// Best-effort mapping from a 2FA issuer name to a website domain
// so we can render its brand logo via Logo.dev.

const OVERRIDES: Record<string, string> = {
  google: "google.com",
  "google account": "google.com",
  gmail: "google.com",
  youtube: "youtube.com",
  github: "github.com",
  gitlab: "gitlab.com",
  bitbucket: "bitbucket.org",
  facebook: "facebook.com",
  instagram: "instagram.com",
  meta: "meta.com",
  whatsapp: "whatsapp.com",
  twitter: "twitter.com",
  x: "x.com",
  discord: "discord.com",
  slack: "slack.com",
  microsoft: "microsoft.com",
  "microsoft account": "microsoft.com",
  outlook: "outlook.com",
  office365: "office.com",
  apple: "apple.com",
  "apple id": "apple.com",
  icloud: "icloud.com",
  amazon: "amazon.com",
  aws: "aws.amazon.com",
  "amazon web services": "aws.amazon.com",
  dropbox: "dropbox.com",
  notion: "notion.so",
  linear: "linear.app",
  figma: "figma.com",
  vercel: "vercel.com",
  netlify: "netlify.com",
  cloudflare: "cloudflare.com",
  digitalocean: "digitalocean.com",
  heroku: "heroku.com",
  supabase: "supabase.com",
  openai: "openai.com",
  anthropic: "anthropic.com",
  chatgpt: "openai.com",
  claude: "anthropic.com",
  linkedin: "linkedin.com",
  reddit: "reddit.com",
  tiktok: "tiktok.com",
  snapchat: "snapchat.com",
  telegram: "telegram.org",
  signal: "signal.org",
  steam: "steampowered.com",
  epicgames: "epicgames.com",
  "epic games": "epicgames.com",
  battlenet: "battle.net",
  "battle.net": "battle.net",
  binance: "binance.com",
  coinbase: "coinbase.com",
  kraken: "kraken.com",
  paypal: "paypal.com",
  stripe: "stripe.com",
  shopify: "shopify.com",
  cloudinary: "cloudinary.com",
  namecheap: "namecheap.com",
  godaddy: "godaddy.com",
  npm: "npmjs.com",
  npmjs: "npmjs.com",
  pypi: "pypi.org",
  atlassian: "atlassian.com",
  jira: "atlassian.com",
  confluence: "atlassian.com",
  trello: "trello.com",
  asana: "asana.com",
  zoom: "zoom.us",
  spotify: "spotify.com",
  twitch: "twitch.tv",
  yahoo: "yahoo.com",
  proton: "proton.me",
  protonmail: "proton.me",
  tutanota: "tutanota.com",
  fastmail: "fastmail.com",
  bitwarden: "bitwarden.com",
  "1password": "1password.com",
  lastpass: "lastpass.com",
  authy: "authy.com",
};

export function domainFromIssuer(issuer?: string | null): string | null {
  if (!issuer) return null;
  const raw = issuer.trim().toLowerCase();
  if (!raw) return null;

  // Already looks like a domain
  const domainLike = raw.match(/([a-z0-9-]+\.[a-z]{2,})(?:\/|$)/);
  if (domainLike) return domainLike[1];

  if (OVERRIDES[raw]) return OVERRIDES[raw];

  // Try the first token
  const first = raw.split(/[\s._\-:/(]+/).filter(Boolean)[0];
  if (first && OVERRIDES[first]) return OVERRIDES[first];

  // Fallback guess: single alphanumeric token → token.com
  if (first && /^[a-z0-9]{2,}$/.test(first)) return `${first}.com`;

  return null;
}

export function logoUrlFor(issuer?: string | null, size = 80): string | null {
  const token = import.meta.env.VITE_LOVABLE_CONNECTOR_LOGO_DEV_API_KEY;
  if (!token) return null;
  const domain = domainFromIssuer(issuer);
  if (!domain) return null;
  return `https://img.logo.dev/${domain}?token=${token}&size=${size}&format=png`;
}
