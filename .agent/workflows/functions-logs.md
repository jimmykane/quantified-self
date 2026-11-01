---
description: View recent Cloud Functions logs
---

# View Cloud Functions Logs

View logs from deployed Firebase Cloud Functions.

## View All Function Logs
```bash
npm --prefix functions run logs
```

## View Specific Function Logs
Replace `<function-name>` with the actual function name:
```bash
npm run firebase -- functions:log --only <function-name>
```

## View Logs with Limit
```bash
npm run firebase -- functions:log -n 50
```
