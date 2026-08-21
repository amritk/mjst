# Python

Add `python` under `targets` to generate a Python SDK package.

Python SDK target config.

```json
{
  "targets": {
    "python": {
      "packageName": "acme_api",
      "projectName": "acme-api"
    }
  }
}
```

| Property | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `packageName` | `string` | ✅ |  | Importable module name for the generated Python package. |
| `projectName` | `string` | ✅ |  | Distribution name published to PyPI. |
| `skip` | `boolean` |  | `false` | Keep the config in place without generating this target. |
