# Follow-up: topk-embed-v1 pricing and input resolution

Date: 2026-10-30. Sources: the topk.io pricing page, the "Introducing topk-embed-v1" post on the TopK
blog, and the open `topk-io/topk-embed-v1-small` and `topk-io/topk-embed-v1-xsmall` model repos on
Hugging Face (`config.json`, `processor_config.json`, `topk_embed_st.py`).

## Price per page (answers Spike B's open question)

The blog lists image embedding for the production model at **$0.075 per 1,000 images**, a flat
price per image, separate from text embedding at $0.05 per 1M tokens. New accounts get $10 of free
credits.

| Item            | Per 1,000 pages            | Notes                                                                       |
| --------------- | -------------------------- | --------------------------------------------------------------------------- |
| Image embedding | $0.075                     | flat per image                                                              |
| Write data      | $0.01–0.07                 | JPEG pages are 20–150 KB (20–150 MB per 1,000 pages); $0.50 per GiB written |
| Write requests  | under $0.001               | about 40 pages per upsert; $0.01 per 1,000 requests                         |
| Storage         | about $0.01 per month      | stored images plus vectors (blog: 5.6–45 KiB of vectors per page)           |
| Queries         | $0.0005 per 1,000 searches | $0.50 per 1M queries                                                        |

So indexing 1,000 pages costs about **$0.09–0.15**, and the $10 credit covers roughly
65,000–110,000 pages before storage. The Stage 2 cost preview can use $0.075 per 1,000 pages for embedding plus
$0.50 per GiB of uploaded image bytes, both computable before uploading.

## Input resolution (relevant to ADR-003)

The open models are fine-tuned from Qwen3.5 (2B for small). Their image preprocessing:

- 16 px patches merged 2×2, so one visual token covers 32×32 px.
- `image_token_budget` is 1,280 in both models' `config.json`, so the model caps images at
  1,280 × 32² = **1,310,720 pixels (about 1.3 MP)** and downscales anything larger, keeping the
  aspect ratio (`smart_resize`). The minimum is 65,536 pixels.

What our render sizes give the model:

| Page shape  | 1024 px long side     | 1536 px                   | 2048 px            |
| ----------- | --------------------- | ------------------------- | ------------------ |
| 16:9 slide  | 1024×576, ~576 tokens | ~1,280 tokens, downscaled | ~1,280, downscaled |
| A4 portrait | 724×1024, ~724 tokens | ~1,280, downscaled        | ~1,280, downscaled |
| US Letter   | 791×1024, ~791 tokens | ~1,280, downscaled        | ~1,280, downscaled |

The 1024 px default (ADR-003) uses only 45–62% of the model's visual budget. Above roughly 1.3 MP,
extra pixels are thrown away by the model and only cost upload bytes and write fees. This matches
the live scores from Spike C, which rose slightly with size (hero page 5.23 at 1024, 5.36 at 1536,
5.42 at 2048).

**Caveat:** this is read from the open small and xsmall models. The blog does not publish the
production model's preprocessing; it is the same family, but TopK should confirm the budget.

## Proposed change (not applied)

Render each page to a pixel budget of about 1.3 MP instead of a fixed long side: scale so that
width × height ≈ 1,310,720 (about 1526×858 for a slide, 963×1362 for A4). That gives every page
shape the model's full detail with no wasted upload. Expected JPEG size is 1.5–2× today's
(still well under 512 KB). This would amend ADR-003 and needs Dave's approval.

## Deferred

Query by image ("Find similar pages") is on hold at Dave's request (2026-10-30).
