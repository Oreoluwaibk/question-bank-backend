import { Router, Request, Response } from "express";
import {
  getPublishedLegalDocument,
  parseLegalSlug,
} from "../services/legalService";

const router = Router();

router.get("/:slug", async (req: Request, res: Response) => {
  const slug = parseLegalSlug(req.params.slug);

  if (!slug) {
    return res.status(404).json({ error: "Legal document not found" });
  }

  try {
    const document = await getPublishedLegalDocument(slug);
    res.json(document);
  } catch (error) {
    console.error("Legal document fetch error:", error);
    res.status(500).json({
      error:
        error instanceof Error ? error.message : "Failed to load legal document",
    });
  }
});

router.get("/:slug/version", async (req: Request, res: Response) => {
  const slug = parseLegalSlug(req.params.slug);

  if (!slug) {
    return res.status(404).json({ error: "Legal document not found" });
  }

  try {
    const document = await getPublishedLegalDocument(slug);
    res.json({ slug: document.slug, version: document.version });
  } catch (error) {
    console.error("Legal version fetch error:", error);
    res.status(500).json({
      error:
        error instanceof Error ? error.message : "Failed to load legal version",
    });
  }
});

export default router;
