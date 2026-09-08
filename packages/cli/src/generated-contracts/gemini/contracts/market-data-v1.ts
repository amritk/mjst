/**
 * Message contract for the AsyncAPI channel `marketDataV1` (/v1/marketdata/{symbol}).
 *
 * Requires `@amritk/api` at runtime — it is a peer dependency of this
 * generated code, not of the mjst CLI that wrote it. Install it in the project
 * that imports this file.
 *
 * Message keys are the wire discriminator values: a frame
 * `{ "event": "<key>", ... }` selects its schema by that key, and the
 * tag is removed before the payload below is validated — which is why no
 * payload here declares it.
 */
import { defineMessages } from '@amritk/api'

export const marketDataV1Messages = defineMessages({
  discriminator: 'event',
  serverToClient: {
    "marketData": {
      "$ref": "#/$defs/market",
      "$defs": {
        "market": {
          "type": "object",
          "oneOf": [
            {
              "$ref": "#/$defs/heartbeat"
            },
            {
              "$ref": "#/$defs/update"
            }
          ]
        },
        "heartbeat": {
          "allOf": [
            {
              "properties": {
                "type": {
                  "type": "string",
                  "const": "heartbeat"
                }
              },
              "required": [
                "type"
              ]
            },
            {
              "$ref": "#/$defs/default"
            }
          ]
        },
        "update": {
          "allOf": [
            {
              "properties": {
                "type": {
                  "type": "string",
                  "const": "update"
                },
                "eventId": {
                  "type": "integer",
                  "description": "A monotonically increasing sequence number indicating when this change occurred. These numbers are persistent and consistent between market data connections."
                },
                "events": {
                  "$ref": "#/$defs/events"
                },
                "timestamp": {
                  "type": "number",
                  "description": "The timestamp in seconds for this group of events (included for compatibility reasons). We recommend using the timestampms field instead."
                },
                "timestampms": {
                  "type": "number",
                  "description": "The timestamp in milliseconds for this group of events."
                }
              },
              "required": [
                "type",
                "eventId",
                "events",
                "timestamp",
                "timestampms"
              ]
            },
            {
              "$ref": "#/$defs/default"
            }
          ]
        },
        "default": {
          "type": "object",
          "description": "This object is always part of the payload. In case of type=heartbeat, these are the only fields.",
          "required": [
            "type",
            "socket_sequence"
          ],
          "properties": {
            "socket_sequence": {
              "type": "integer",
              "description": "zero-indexed monotonic increasing sequence number attached to each message sent - if there is a gap in this sequence, you have missed a message. If you choose to enable heartbeats, then heartbeat and update messages will share a single increasing sequence. See [Sequence Numbers](https://docs.sandbox.gemini.com/websocket-api/#sequence-numbers) for more information."
            }
          }
        },
        "events": {
          "type": "array",
          "description": "Either a change to the order book, or the indication that a trade has occurred.",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "type": {
                "type": "string",
                "enum": [
                  "trade",
                  "change",
                  "auction, block_trade"
                ]
              },
              "price": {
                "type": "number",
                "multipleOf": 0.01,
                "description": "The price of this order book entry."
              },
              "side": {
                "type": "string",
                "enum": [
                  "bid",
                  "side"
                ]
              },
              "reason": {
                "type": "string",
                "enum": [
                  "place",
                  "trade",
                  "cancel",
                  "initial"
                ],
                "description": "Indicates why the change has occurred. initial is for the initial response message, which will show the entire existing state of the order book."
              },
              "remaining": {
                "type": "number",
                "description": "The quantity remaining at that price level after this change occurred. May be zero if all orders at this price level have been filled or canceled."
              },
              "delta": {
                "type": "number",
                "description": "The quantity changed. May be negative, if an order is filled or canceled. For initial messages, delta will equal remaining."
              }
            }
          }
        }
      }
    } as const,
  },
})
