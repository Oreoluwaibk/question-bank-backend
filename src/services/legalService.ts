import { supabaseAdmin } from "./supabaseAdmin";
import {
  DEFAULT_LEGAL_BY_SLUG,
  type LegalDocumentContent,
  type LegalSlug,
} from "../data/defaultLegalDocuments";

export type { LegalDocumentContent, LegalSlug };

export type LegalDocument = LegalDocumentContent & {
  slug: LegalSlug;
  version: string;
  updatedAt: string;
};

type LegalRow = {
  slug: LegalSlug;
  version: string;
  title: string;
  last_updated: string;
  intro: string;
  sections: LegalDocumentContent["sections"];
  updated_at: string;
};

const LEGAL_SLUGS: LegalSlug[] = ["terms", "privacy"];

function isLegalSlug(value: string): value is LegalSlug {
  return value === "terms" || value === "privacy";
}

function nextVersion(currentVersion: string | null) {
  const today = new Date().toISOString().slice(0, 10);
  if (currentVersion?.startsWith(today)) {
    return `${today}.${Date.now()}`;
  }
  return today;
}

function mapRow(row: LegalRow): LegalDocument {
  return {
    slug: row.slug,
    version: row.version,
    title: row.title,
    lastUpdated: row.last_updated,
    intro: row.intro,
    sections: row.sections ?? [],
    updatedAt: row.updated_at,
  };
}

function validateContent(content: LegalDocumentContent) {
  if (!content.title?.trim()) {
    throw new Error("title is required");
  }
  if (!content.lastUpdated?.trim()) {
    throw new Error("lastUpdated is required");
  }
  if (!content.intro?.trim()) {
    throw new Error("intro is required");
  }
  if (!Array.isArray(content.sections) || content.sections.length === 0) {
    throw new Error("sections must be a non-empty array");
  }

  for (const section of content.sections) {
    if (!section.title?.trim()) {
      throw new Error("each section needs a title");
    }
    if (!Array.isArray(section.body) || section.body.length === 0) {
      throw new Error(`section "${section.title}" needs at least one paragraph`);
    }
  }
}

async function upsertDefaultDocument(slug: LegalSlug) {
  const defaults = DEFAULT_LEGAL_BY_SLUG[slug];
  const version = new Date().toISOString().slice(0, 10);

  const { data, error } = await supabaseAdmin
    .from("legal_documents")
    .upsert(
      {
        slug,
        version,
        title: defaults.title,
        last_updated: defaults.lastUpdated,
        intro: defaults.intro,
        sections: defaults.sections,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "slug" }
    )
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return mapRow(data as LegalRow);
}

function fallbackDocument(slug: LegalSlug): LegalDocument {
  const defaults = DEFAULT_LEGAL_BY_SLUG[slug];
  const version = new Date().toISOString().slice(0, 10);

  return {
    slug,
    version,
    title: defaults.title,
    lastUpdated: defaults.lastUpdated,
    intro: defaults.intro,
    sections: defaults.sections,
    updatedAt: new Date().toISOString(),
  };
}

function isMissingLegalTableError(message: string) {
  return /legal_documents/i.test(message);
}

export async function getPublishedLegalDocument(slug: LegalSlug) {
  const { data, error } = await supabaseAdmin
    .from("legal_documents")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    if (isMissingLegalTableError(error.message)) {
      return fallbackDocument(slug);
    }
    throw new Error(error.message);
  }

  if (!data) {
    try {
      return await upsertDefaultDocument(slug);
    } catch (upsertError) {
      if (
        upsertError instanceof Error &&
        isMissingLegalTableError(upsertError.message)
      ) {
        return fallbackDocument(slug);
      }
      throw upsertError;
    }
  }

  return mapRow(data as LegalRow);
}

export async function getPublishedTermsVersion() {
  const document = await getPublishedLegalDocument("terms");
  return document.version;
}

export async function listLegalDocuments() {
  await Promise.all(LEGAL_SLUGS.map((slug) => getPublishedLegalDocument(slug)));

  const { data, error } = await supabaseAdmin
    .from("legal_documents")
    .select("*")
    .in("slug", LEGAL_SLUGS)
    .order("slug", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => mapRow(row as LegalRow));
}

export async function updateLegalDocument(
  slug: LegalSlug,
  content: LegalDocumentContent
) {
  validateContent(content);

  const { data: existing, error: existingError } = await supabaseAdmin
    .from("legal_documents")
    .select("version")
    .eq("slug", slug)
    .maybeSingle();

  if (existingError) {
    throw new Error(existingError.message);
  }

  const version = nextVersion((existing as { version?: string } | null)?.version ?? null);
  const updatedAt = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from("legal_documents")
    .upsert(
      {
        slug,
        version,
        title: content.title.trim(),
        last_updated: content.lastUpdated.trim(),
        intro: content.intro.trim(),
        sections: content.sections,
        updated_at: updatedAt,
      },
      { onConflict: "slug" }
    )
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return mapRow(data as LegalRow);
}

export function parseLegalSlug(value: string): LegalSlug | null {
  return isLegalSlug(value) ? value : null;
}
