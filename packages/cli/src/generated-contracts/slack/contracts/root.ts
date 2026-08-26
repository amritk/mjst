/**
 * Message contract for the AsyncAPI channel `root` (/).
 *
 * Requires `@amritk/api` at runtime — it is a peer dependency of this
 * generated code, not of the mjst CLI that wrote it. Install it in the project
 * that imports this file.
 *
 * Message keys are the wire discriminator values: a frame
 * `{ "type": "<key>", ... }` selects its schema by that key, and the
 * tag is removed before the payload below is validated — which is why no
 * payload here declares it.
 */
import { defineMessages } from '@amritk/api'

export const rootMessages = defineMessages({
  discriminator: 'type',
  serverToClient: {
    "hello": {
      "type": "object"
    } as const,
    "goodbye": {
      "type": "object"
    } as const,
    "message": {
      "type": "object",
      "properties": {
        "user": {
          "type": "string"
        },
        "channel": {
          "type": "string"
        },
        "text": {
          "type": "string"
        },
        "ts": {
          "type": "string"
        },
        "attachments": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/attachment"
          }
        },
        "edited": {
          "type": "object",
          "properties": {
            "user": {
              "type": "string"
            },
            "ts": {
              "type": "string"
            }
          }
        }
      },
      "$defs": {
        "attachment": {
          "type": "object",
          "properties": {
            "fallback": {
              "type": "string"
            },
            "color": {
              "type": "string"
            },
            "pretext": {
              "type": "string"
            },
            "author_name": {
              "type": "string"
            },
            "author_link": {
              "type": "string",
              "format": "uri"
            },
            "author_icon": {
              "type": "string",
              "format": "uri"
            },
            "title": {
              "type": "string"
            },
            "title_link": {
              "type": "string",
              "format": "uri"
            },
            "text": {
              "type": "string"
            },
            "fields": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "title": {
                    "type": "string"
                  },
                  "value": {
                    "type": "string"
                  },
                  "short": {
                    "type": "boolean"
                  }
                }
              }
            },
            "image_url": {
              "type": "string",
              "format": "uri"
            },
            "thumb_url": {
              "type": "string",
              "format": "uri"
            },
            "footer": {
              "type": "string"
            },
            "footer_icon": {
              "type": "string",
              "format": "uri"
            },
            "ts": {
              "type": "number"
            }
          }
        }
      }
    } as const,
  },
})
