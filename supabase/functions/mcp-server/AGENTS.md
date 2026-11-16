# mcp-server

- Company setup over MCP (`create_company`, `update_company`, `upload_media`, `create_product`, `update_product`) writes only an explicit field allowlist; billing, go-live, subscription, webhook, flow and Meta ids are never MCP-writable. New-company defaults live in `_shared/company-defaults.ts`, shared with the dashboard's `create-company` — never add a second defaults set. Pure validators live in `_shared/mcp-company-validators.ts` (tested).
