# CommitPool Envio indexer

Public pool events only; no private journal data. Requires Linux/WSL or Envio Cloud.

```
npm install
npm run codegen
npm test
npm run dev
```

Deploy with this directory as project root. Set the app's `VITE_ENVIO_URL` to its public GraphQL endpoint and rebuild. See [deployment and verification](../docs/METROPOLIS.md). Codegen/live indexing require a supported host; projection tests run on Windows too.
