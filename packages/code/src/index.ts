import { ShikiStreamTokenizer } from "@shikijs/stream";
import type {
  CodeHighlighter,
  CodeHighlightLine,
  CodeHighlightPalette,
  CodeHighlightResult,
  CodeHighlightToken,
  CodeTokenStyle,
} from "@smoothstream/core";
import {
  createHighlighterCore,
  guessEmbeddedLanguages,
  type DynamicImportLanguageRegistration,
  type HighlighterCore,
  type ThemedToken,
} from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { bundledLanguagesInfo } from "shiki/langs";
import { bundledThemes, type BundledTheme } from "shiki/themes";

export type ShikiCodeHighlighterDefaultColor =
  | "dark"
  | "light"
  | "light-dark()"
  | false;

export interface ShikiCodeHighlighterThemes {
  readonly dark: BundledTheme;
  readonly light: BundledTheme;
}

interface ShikiCodeHighlighterSingleThemeOptions {
  /** The name of a bundled Shiki theme. @default "github-light" */
  readonly theme?: BundledTheme;
  readonly themes?: never;
  readonly defaultColor?: never;
}

interface ShikiCodeHighlighterMultipleThemeOptions {
  /** Shiki themes emitted together for light/dark presentation. */
  readonly themes: ShikiCodeHighlighterThemes;
  readonly theme?: never;
  /** Shiki's default color strategy. @default "light" */
  readonly defaultColor?: ShikiCodeHighlighterDefaultColor;
}

interface ShikiCodeHighlighterPresentationOptions {
  /** Show a language label above each fenced code block. @default true */
  readonly showLanguageLabels?: boolean;
}

export type ShikiCodeHighlighterOptions = ShikiCodeHighlighterPresentationOptions &
  (
    | ShikiCodeHighlighterSingleThemeOptions
    | ShikiCodeHighlighterMultipleThemeOptions
  );

interface LanguageDefinition {
  readonly displayName: string;
  readonly id: string;
  readonly import: DynamicImportLanguageRegistration;
}

interface HighlightSession {
  code: string;
  language: string;
  lines: CodeHighlightLine[];
  pending: Promise<void>;
  tokenizer: ShikiStreamTokenizer | undefined;
  trailingTokens: CodeHighlightToken[];
}

const PLAIN_LANGUAGES = new Set(["plain", "plaintext", "text", "txt"]);

const INTRINSIC_COMPANION_LANGUAGES: Readonly<
  Record<string, ReadonlyArray<string>>
> = {
  haml: ["ruby"],
  mdx: ["tsx"],
};

const languageDefinitions = new Map<string, LanguageDefinition>();
for (const info of bundledLanguagesInfo) {
  const definition: LanguageDefinition = {
    displayName: info.name,
    id: info.id,
    import: info.import,
  };
  languageDefinitions.set(info.id.toLowerCase(), definition);
  for (const alias of info.aliases ?? []) {
    languageDefinitions.set(alias.toLowerCase(), definition);
  }
}

const normalizeLanguage = (language: string): string =>
  language.trim().toLowerCase();

const tokenStyle = (token: ThemedToken): CodeTokenStyle | undefined => {
  if (token.htmlStyle) {
    return Object.fromEntries(
      Object.entries(token.htmlStyle).map(([property, value]) => [
        property.startsWith("--")
          ? property
          : property.replace(/-([a-z])/gu, (_, character: string) =>
              character.toUpperCase()),
        value,
      ]),
    );
  }

  const style: Record<string, number | string> = {};
  if (token.color) {
    style.color = token.color;
  }
  if (token.bgColor) {
    style.backgroundColor = token.bgColor;
  }
  if (token.fontStyle !== undefined && token.fontStyle > 0) {
    if ((token.fontStyle & 1) !== 0) {
      style.fontStyle = "italic";
    }
    if ((token.fontStyle & 2) !== 0) {
      style.fontWeight = 700;
    }
    if ((token.fontStyle & 4) !== 0) {
      style.textDecorationLine = "underline";
    }
    if ((token.fontStyle & 8) !== 0) {
      style.textDecorationLine = style.textDecorationLine
        ? `${style.textDecorationLine} line-through`
        : "line-through";
    }
  }
  return Object.keys(style).length > 0 ? style : undefined;
};

const appendStableTokens = (
  session: HighlightSession,
  tokens: ReadonlyArray<ThemedToken>,
): void => {
  for (const token of tokens) {
    const parts = token.content.split("\n");
    parts.forEach((content, index) => {
      if (content.length > 0) {
        const style = tokenStyle(token);
        session.trailingTokens.push({
          content,
          ...(style ? { style } : {}),
        });
      }
      if (index < parts.length - 1) {
        session.lines.push({ tokens: session.trailingTokens });
        session.trailingTokens = [];
      }
    });
  }
};

const plainResult = (
  code: string,
  languageLabel: string | undefined,
  palette?: CodeHighlightPalette,
): CodeHighlightResult => {
  const lines = code.split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return {
    lines: lines.map((line) => ({
      tokens: line.length > 0 ? [{ content: line }] : [],
    })),
    ...(languageLabel ? { languageLabel } : {}),
    ...(palette ? { palette } : {}),
  };
};

/**
 * Creates Smoothstream's optional Shiki adapter. Language grammars are emitted as
 * lazy chunks and only fetched when a matching fenced block is encountered.
 */
export const createCodeHighlighter = (
  options: ShikiCodeHighlighterOptions = {},
): CodeHighlighter => {
  const unsafeOptions = options as {
    readonly defaultColor?: ShikiCodeHighlighterDefaultColor;
    readonly showLanguageLabels?: boolean;
    readonly theme?: BundledTheme;
    readonly themes?: ShikiCodeHighlighterThemes;
  };
  if (unsafeOptions.theme !== undefined && unsafeOptions.themes !== undefined) {
    throw new Error(
      '@smoothstream/code: "theme" and "themes" are mutually exclusive.',
    );
  }

  const themes = unsafeOptions.themes;
  const theme = themes ? undefined : (unsafeOptions.theme ?? "github-light");
  const defaultColor = unsafeOptions.defaultColor ?? "light";
  const showLanguageLabels = unsafeOptions.showLanguageLabels ?? true;
  const themeNames = themes
    ? [themes.light, themes.dark]
    : [theme ?? "github-light"];
  const themeImports = themeNames.map((themeName) => {
    const themeImport = bundledThemes[themeName];
    if (!themeImport) {
      throw new Error(`Unknown bundled Shiki theme: ${themeName}`);
    }
    return themeImport;
  });
  let baseHighlighter: Promise<HighlighterCore> | undefined;
  const languageLoads = new Map<string, Promise<HighlighterCore>>();
  const sessions = new WeakMap<object, HighlightSession>();

  const loadBaseHighlighter = (): Promise<HighlighterCore> => {
    baseHighlighter ??= createHighlighterCore({
      engine: createJavaScriptRegexEngine(),
      langs: [],
      themes: themeImports,
    });
    return baseHighlighter;
  };

  const loadLanguage = (
    definition: LanguageDefinition,
  ): Promise<HighlighterCore> => {
    const cached = languageLoads.get(definition.id);
    if (cached) {
      return cached;
    }
    const highlighter = loadBaseHighlighter().then(async (loaded) => {
      await loaded.loadLanguage(definition.import);
      return loaded;
    });
    languageLoads.set(definition.id, highlighter);
    return highlighter;
  };

  const loadCompanionLanguages = async (
    code: string,
    language: string,
  ): Promise<void> => {
    const definitions = new Map<string, LanguageDefinition>();
    const companionLanguages = [
      ...(INTRINSIC_COMPANION_LANGUAGES[language] ?? []),
      ...guessEmbeddedLanguages(code, language),
    ];
    for (const embeddedLanguage of companionLanguages) {
      const definition = languageDefinitions.get(
        normalizeLanguage(embeddedLanguage),
      );
      if (definition) {
        definitions.set(definition.id, definition);
      }
    }
    await Promise.all([...definitions.values()].map(loadLanguage));
  };

  const themePalette = (highlighter: HighlighterCore): CodeHighlightPalette => {
    if (themes) {
      const light = highlighter.getTheme(themes.light);
      const dark = highlighter.getTheme(themes.dark);
      const style: CodeTokenStyle = {
        "--shiki-dark": dark.fg,
        "--shiki-dark-bg": dark.bg,
        "--shiki-light": light.fg,
        "--shiki-light-bg": light.bg,
      };
      if (defaultColor === false) {
        return { style };
      }
      if (defaultColor === "dark") {
        return {
          backgroundColor: dark.bg,
          color: dark.fg,
          style,
        };
      }
      if (defaultColor === "light-dark()") {
        return {
          backgroundColor: `light-dark(${light.bg}, ${dark.bg})`,
          color: `light-dark(${light.fg}, ${dark.fg})`,
          style,
        };
      }
      return {
        backgroundColor: light.bg,
        color: light.fg,
        style,
      };
    }

    const loadedTheme = highlighter.getTheme(theme ?? "github-light");
    return {
      backgroundColor: loadedTheme.bg,
      color: loadedTheme.fg,
    };
  };

  const process = async (
    session: HighlightSession,
    code: string,
    language: string,
  ): Promise<CodeHighlightResult> => {
    const normalized = normalizeLanguage(language);
    const definition = languageDefinitions.get(normalized);
    const highlighter = definition
      ? await loadLanguage(definition)
      : await loadBaseHighlighter();
    const palette = themePalette(highlighter);
    const languageLabel = showLanguageLabels
      ? definition?.displayName ?? (
        PLAIN_LANGUAGES.has(normalized)
          ? "Plain text"
          : language.trim() || "Plain text"
      )
      : undefined;
    if (PLAIN_LANGUAGES.has(normalized)) {
      return plainResult(code, languageLabel, palette);
    }
    if (!definition) {
      return plainResult(code, languageLabel, palette);
    }

    await loadCompanionLanguages(code, definition.id);

    if (session.language !== definition.id || !code.startsWith(session.code)) {
      session.code = "";
      session.language = definition.id;
      session.lines = [];
      session.tokenizer = undefined;
      session.trailingTokens = [];
    }
    if (session.code === code) {
      return {
        ...(languageLabel ? { languageLabel } : {}),
        lines: session.lines,
        palette,
      };
    }

    if (!session.tokenizer) {
      session.tokenizer = themes
        ? new ShikiStreamTokenizer({
            defaultColor,
            highlighter,
            lang: definition.id,
            themes: {
              dark: themes.dark,
              light: themes.light,
            },
          })
        : new ShikiStreamTokenizer({
            highlighter,
            lang: definition.id,
            theme: theme ?? "github-light",
          });
    }

    const delta = code.slice(session.code.length);
    const { stable } = await session.tokenizer.enqueue(delta);
    appendStableTokens(session, stable);
    session.code = code;
    return {
      ...(languageLabel ? { languageLabel } : {}),
      lines: [...session.lines],
      palette,
    };
  };

  return {
    name: "@smoothstream/code",
    showLanguageLabels,
    supportsLanguage: (language) => {
      const normalized = normalizeLanguage(language);
      return PLAIN_LANGUAGES.has(normalized) ||
        languageDefinitions.has(normalized);
    },
    highlight: (request) => {
      let session = sessions.get(request.session);
      if (!session) {
        session = {
          code: "",
          language: "",
          lines: [],
          pending: Promise.resolve(),
          tokenizer: undefined,
          trailingTokens: [],
        };
        sessions.set(request.session, session);
      }

      const result = session.pending
        .catch(() => undefined)
        .then(() => process(session, request.code, request.language));
      session.pending = result.then(
        () => undefined,
        () => {
          // A tokenizer may already have advanced internally before throwing.
          // Reset it so a later append retries from the complete committed code.
          session.code = "";
          session.language = "";
          session.lines = [];
          session.tokenizer = undefined;
          session.trailingTokens = [];
        },
      );
      return result;
    },
  };
};

/** Ready-to-use GitHub Light highlighter for the common setup. */
export const codeHighlighter = createCodeHighlighter();
