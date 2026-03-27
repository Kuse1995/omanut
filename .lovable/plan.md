

# Expand MCP Server: Image/Video, Brand Alignment & Scheduling Tools

## Problem
The MCP server currently exposes zero tools for the image/video generation pipeline, brand identity profiles, scheduled posts, or generated content history. These are the exact areas where OpenClaw could provide the most value — auditing brand alignment, reviewing generated content, managing the post queue, and analyzing video generation success rates.

## New MCP Tools to Add

### Content Scheduling (3 tools)
| Tool | Description |
|---|---|
| `list_scheduled_posts` | List posts by status (pending_approval, approved, published, failed). See the full content queue. |
| `review_scheduled_post` | Approve, reject, or edit a scheduled post — enable OpenClaw to act as a content approval agent. |
| `create_scheduled_post` | Create a new scheduled post with caption, image URL, platform target, and scheduled time. |

### Image Generation (3 tools)
| Tool | Description |
|---|---|
| `list_generated_images` | List AI-generated images with prompts, approval status, and URLs — audit what the AI is producing. |
| `get_image_generation_settings` | Read the company's image gen config: style, tone, brand colors, visual guidelines. |
| `update_image_generation_settings` | Tune style description, brand tone, visual guidelines, brand colors — fix brand drift without touching code. |

### Brand Identity (2 tools)
| Tool | Description |
|---|---|
| `list_product_identity_profiles` | List all product identity fingerprints — hex colors, labels, packaging shapes, exclusion keywords. Audit for brand contamination. |
| `update_product_identity_profile` | Edit exclusion keywords, visual fingerprints, or brand colors on a profile — fix brand alignment issues directly. |

### Video Generation (1 tool)
| Tool | Description |
|---|---|
| `list_video_jobs` | List video generation jobs with status, provider (MiniMax/Veo), aspect ratio, prompt, and result URL. Diagnose failures and track quality. |

## High-Impact Use Cases

**1. Brand Alignment Auditor**
OpenClaw pulls `list_generated_images` + `list_product_identity_profiles`, cross-references prompts against brand fingerprints, flags images that mention excluded products or wrong colors, and auto-updates exclusion keywords via `update_product_identity_profile`.

**2. Content Queue Manager**
OpenClaw reviews `list_scheduled_posts` (pending_approval), analyzes caption quality and image-caption alignment, then batch-approves good posts and flags problematic ones — acting as a 24/7 content approval agent.

**3. Image Style Drift Detector**
OpenClaw periodically reads `get_image_generation_settings` and compares recent `list_generated_images` prompts against the configured style/tone. If prompts are drifting from brand guidelines, it updates settings via `update_image_generation_settings`.

**4. Video Generation Monitor**
OpenClaw checks `list_video_jobs` for failed jobs, wrong aspect ratios, or provider misroutes. Creates tickets for systematic failures and adjusts AI config if needed.

**5. Automated Post Creation Pipeline**
OpenClaw analyzes customer conversations for trending topics → generates caption ideas → creates scheduled posts via `create_scheduled_post` with appropriate timing from `best_posting_times` in image gen settings.

## Files Modified
- `supabase/functions/mcp-server/index.ts` — add 9 new tools
- `openclaw-skill.json` — update tools_overview with new capabilities

