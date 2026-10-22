/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_GITHUB_URL?: string;
  readonly PUBLIC_LOOPS_FORM_ID?: string;
  readonly PUBLIC_LOOPS_DOUBLE_OPT_IN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
