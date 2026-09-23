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
| [`packageName`](#packagename) | `string` | ✅ |  | Importable module name for the generated Python package. |
| [`projectName`](#projectname) | `string` | ✅ |  | Distribution name published to PyPI. |
| `skip` | `boolean` |  | `false` | Keep the config in place without generating this target. |

## packageName

**Examples:** `"acme_api"`

## projectName

**Examples:** `"acme-api"`
