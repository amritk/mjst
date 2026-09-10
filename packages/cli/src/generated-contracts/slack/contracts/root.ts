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
  clientToServer: {
    "message": {
      "type": "object",
      "properties": {
        "id": {
          "type": "number"
        },
        "channel": {
          "type": "string"
        },
        "text": {
          "type": "string"
        }
      }
    } as const,
  },
  serverToClient: {
    "hello": {
      "type": "object"
    } as const,
    "error": {
      "type": "object",
      "properties": {
        "error": {
          "type": "object",
          "properties": {
            "code": {
              "type": "number"
            },
            "msg": {
              "type": "string"
            }
          }
        }
      }
    } as const,
    "accounts_changed": {
      "type": "object"
    } as const,
    "bot_added": {
      "type": "object",
      "properties": {
        "bot": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string"
            },
            "app_id": {
              "type": "string"
            },
            "name": {
              "type": "string"
            },
            "icons": {
              "type": "object",
              "additionalProperties": {
                "type": "string"
              }
            }
          }
        }
      }
    } as const,
    "channel_archive": {
      "type": "object",
      "properties": {
        "channel": {
          "type": "string"
        },
        "user": {
          "type": "string"
        }
      }
    } as const,
    "channel_created": {
      "type": "object",
      "properties": {
        "channel": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string"
            },
            "name": {
              "type": "string"
            },
            "created": {
              "type": "number"
            },
            "creator": {
              "type": "string"
            }
          }
        }
      }
    } as const,
    "channel_deleted": {
      "type": "object",
      "properties": {
        "channel": {
          "type": "string"
        }
      }
    } as const,
    "channel_history_changed": {
      "type": "object",
      "properties": {
        "latest": {
          "type": "string"
        },
        "ts": {
          "type": "string"
        },
        "event_ts": {
          "type": "string"
        }
      }
    } as const,
    "channel_joined": {
      "type": "object",
      "properties": {
        "channel": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string"
            },
            "name": {
              "type": "string"
            },
            "created": {
              "type": "number"
            },
            "creator": {
              "type": "string"
            }
          }
        }
      }
    } as const,
    "channel_left": {
      "type": "object",
      "properties": {
        "channel": {
          "type": "string"
        }
      }
    } as const,
    "channel_marked": {
      "type": "object",
      "properties": {
        "channel": {
          "type": "string"
        },
        "ts": {
          "type": "string"
        }
      }
    } as const,
    "channel_rename": {
      "type": "object",
      "properties": {
        "channel": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string"
            },
            "name": {
              "type": "string"
            },
            "created": {
              "type": "number"
            }
          }
        }
      }
    } as const,
    "channel_unarchive": {
      "type": "object",
      "properties": {
        "channel": {
          "type": "string"
        },
        "user": {
          "type": "string"
        }
      }
    } as const,
    "commands_changed": {
      "type": "object",
      "properties": {
        "event_ts": {
          "type": "string"
        }
      }
    } as const,
    "dnd_updated": {
      "type": "object",
      "properties": {
        "user": {
          "type": "string"
        },
        "dnd_status": {
          "type": "object",
          "properties": {
            "dnd_enabled": {
              "type": "boolean"
            },
            "next_dnd_start_ts": {
              "type": "number"
            },
            "next_dnd_end_ts": {
              "type": "number"
            },
            "snooze_enabled": {
              "type": "boolean"
            },
            "snooze_endtime": {
              "type": "number"
            }
          }
        }
      }
    } as const,
    "dnd_updated_user": {
      "type": "object",
      "properties": {
        "user": {
          "type": "string"
        },
        "dnd_status": {
          "type": "object",
          "properties": {
            "dnd_enabled": {
              "type": "boolean"
            },
            "next_dnd_start_ts": {
              "type": "number"
            },
            "next_dnd_end_ts": {
              "type": "number"
            }
          }
        }
      }
    } as const,
    "email_domain_changed": {
      "type": "object",
      "properties": {
        "email_domain": {
          "type": "string"
        },
        "event_ts": {
          "type": "string"
        }
      }
    } as const,
    "emoji_changed": {
      "type": "object",
      "properties": {
        "subtype": {
          "type": "string",
          "enum": [
            "remove"
          ]
        },
        "names": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "event_ts": {
          "type": "string"
        }
      }
    } as const,
    "file_change": {
      "type": "object",
      "properties": {
        "file_id": {
          "type": "string"
        },
        "file": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string"
            }
          }
        }
      }
    } as const,
    "file_comment_added": {
      "type": "object",
      "properties": {
        "comment": {},
        "file_id": {
          "type": "string"
        },
        "file": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string"
            }
          }
        }
      }
    } as const,
    "file_comment_deleted": {
      "type": "object",
      "properties": {
        "comment": {
          "type": "string"
        },
        "file_id": {
          "type": "string"
        },
        "file": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string"
            }
          }
        }
      }
    } as const,
    "file_comment_edited": {
      "type": "object",
      "properties": {
        "comment": {},
        "file_id": {
          "type": "string"
        },
        "file": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string"
            }
          }
        }
      }
    } as const,
    "file_created": {
      "type": "object",
      "properties": {
        "file_id": {
          "type": "string"
        },
        "file": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string"
            }
          }
        }
      }
    } as const,
    "file_deleted": {
      "type": "object",
      "properties": {
        "file_id": {
          "type": "string"
        },
        "event_ts": {
          "type": "string"
        }
      }
    } as const,
    "file_public": {
      "type": "object",
      "properties": {
        "file_id": {
          "type": "string"
        },
        "file": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string"
            }
          }
        }
      }
    } as const,
    "file_shared": {
      "type": "object",
      "properties": {
        "file_id": {
          "type": "string"
        },
        "file": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string"
            }
          }
        }
      }
    } as const,
    "file_unshared": {
      "type": "object",
      "properties": {
        "file_id": {
          "type": "string"
        },
        "file": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string"
            }
          }
        }
      }
    } as const,
    "goodbye": {
      "type": "object"
    } as const,
    "group_archive": {
      "type": "object",
      "properties": {
        "channel": {
          "type": "string"
        }
      }
    } as const,
    "group_close": {
      "type": "object",
      "properties": {
        "user": {
          "type": "string"
        },
        "channel": {
          "type": "string"
        }
      }
    } as const,
    "group_history_changed": {
      "type": "object",
      "properties": {
        "latest": {
          "type": "string"
        },
        "ts": {
          "type": "string"
        },
        "event_ts": {
          "type": "string"
        }
      }
    } as const,
    "group_joined": {
      "type": "object",
      "properties": {
        "channel": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string"
            },
            "name": {
              "type": "string"
            },
            "created": {
              "type": "number"
            },
            "creator": {
              "type": "string"
            }
          }
        }
      }
    } as const,
    "group_left": {
      "type": "object",
      "properties": {
        "channel": {
          "type": "string"
        }
      }
    } as const,
    "group_marked": {
      "type": "object",
      "properties": {
        "channel": {
          "type": "string"
        },
        "ts": {
          "type": "string"
        }
      }
    } as const,
    "group_open": {
      "type": "object",
      "properties": {
        "user": {
          "type": "string"
        },
        "channel": {
          "type": "string"
        }
      }
    } as const,
    "group_rename": {
      "type": "object",
      "properties": {
        "channel": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string"
            },
            "name": {
              "type": "string"
            },
            "created": {
              "type": "number"
            }
          }
        }
      }
    } as const,
    "group_unarchive": {
      "type": "object",
      "properties": {
        "channel": {
          "type": "string"
        },
        "user": {
          "type": "string"
        }
      }
    } as const,
    "im_close": {
      "type": "object",
      "properties": {
        "channel": {
          "type": "string"
        },
        "user": {
          "type": "string"
        }
      }
    } as const,
    "im_created": {
      "type": "object",
      "properties": {
        "channel": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string"
            },
            "name": {
              "type": "string"
            },
            "created": {
              "type": "number"
            },
            "creator": {
              "type": "string"
            }
          }
        },
        "user": {
          "type": "string"
        }
      }
    } as const,
    "im_marked": {
      "type": "object",
      "properties": {
        "channel": {
          "type": "string"
        },
        "ts": {
          "type": "string"
        }
      }
    } as const,
    "im_open": {
      "type": "object",
      "properties": {
        "channel": {
          "type": "string"
        },
        "user": {
          "type": "string"
        }
      }
    } as const,
    "manual_presence_change": {
      "type": "object",
      "properties": {
        "presence": {
          "type": "string"
        }
      }
    } as const,
    "member_joined_channel": {
      "type": "object",
      "properties": {
        "user": {
          "type": "string"
        },
        "channel": {
          "type": "string"
        },
        "channel_type": {
          "type": "string",
          "enum": [
            "C",
            "G"
          ]
        },
        "team": {
          "type": "string"
        },
        "inviter": {
          "type": "string"
        }
      }
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
