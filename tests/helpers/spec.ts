export function makeSpec() {
  return {
    openapi: "3.2.0",
    info: { title: "Test API", version: "1.0.0" },
    servers: [
      {
        url: "https://{host}/v1",
        variables: {
          host: {
            default: "api.example.com",
            enum: ["api.example.com", "staging.example.com"],
          },
        },
      },
    ],
    paths: {
      "/users/{id}": {
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        get: {
          operationId: "getUser",
          parameters: [
            {
              name: "include",
              in: "query",
              required: false,
              style: "form",
              explode: true,
              schema: {
                type: "array",
                items: {
                  type: "string",
                  enum: ["profile", "roles"],
                },
              },
            },
          ],
          responses: {
            "200": {
              description: "The requested user",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/User" },
                },
              },
            },
          },
        },
      },

      "/users/boom": {
        get: {
          operationId: "getBoomUser",
          responses: {
            "500": {
              description: "Server error",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      error: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },

      "/orders": {
        post: {
          operationId: "createOrder",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["sku", "qty"],
                  properties: {
                    sku: { type: "string" },
                    qty: { type: "integer", minimum: 1 },
                  },
                },
              },
            },
          },
          responses: {
            "201": { description: "Order created" },
          },
        },
      },

      "/chat/completions": {
        post: {
          operationId: "streamChat",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    model: { type: "string", default: "demo-model" },
                    stream: { type: "boolean", default: true },
                    messages: {
                      type: "array",
                      items: { type: "object" },
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "A stream of completion chunks",
              content: {
                "text/event-stream": {},
              },
            },
          },
        },
      },

      "/chat/endless": {
        post: {
          operationId: "endlessChat",
          responses: {
            "200": {
              description: "Never-ending stream",
              content: {
                "text/event-stream": {},
              },
            },
          },
        },
      },

      "/chat/truncated": {
        post: {
          operationId: "truncatedChat",
          responses: {
            "200": {
              description: "Truncated stream",
              content: {
                "text/event-stream": {},
              },
            },
          },
        },
      },

      "/realtime/{room}": {
        parameters: [
          {
            name: "room",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        get: {
          operationId: "joinRoom",
          "x-protocol": "websocket",
          "x-websocket": {
            subprotocols: ["json.v1"],
            keepAlive: { intervalMs: 15_000, payload: "ping" },
          },
          responses: {
            "101": { description: "Switching protocols" },
          },
        },
      },
    },

    components: {
      schemas: {
        User: {
          type: "object",
          required: ["id", "name"],
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            email: { type: "string", format: "email" },
          },
        },
      },
    },
  };
}
