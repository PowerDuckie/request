import http from "node:http";
import { buildSchema, graphql } from "graphql";

// node examples/graphql/server.mjs &
// GRAPHQL_URL=http://127.0.0.1:4100/graphql node examples/graphql/demo.mjs

const schema = buildSchema(`
  enum Role { ADMIN MEMBER GUEST }

  type User {
    id: ID!
    name: String!
    email: String
    role: Role!
  }

  type Post {
    id: ID!
    title: String!
    body: String!
    author: User!
    publishedAt: String
  }

  input CreatePostInput {
    title: String!
    body: String!
    authorId: ID!
  }

  type Query {
    "Fetch a single user by id."
    user(id: ID!): User
    "List users, optionally filtered by role."
    users(role: Role): [User!]!
    post(id: ID!): Post
  }

  type Mutation {
    createPost(input: CreatePostInput!): Post!
  }
`);

const users = new Map([
  ["1", { id: "1", name: "Ada Lovelace", email: "ada@example.com", role: "ADMIN" }],
  ["2", { id: "2", name: "Grace Hopper", email: "grace@example.com", role: "MEMBER" }],
  ["3", { id: "3", name: "Alan Turing", email: null, role: "GUEST" }],
]);

const posts = new Map([
  [
    "p1",
    {
      id: "p1",
      title: "Hello, GraphQL",
      body: "First post.",
      authorId: "1",
      publishedAt: new Date().toISOString(),
    },
  ],
]);
let nextPostId = 2;

const root = {
  user: ({ id }) => users.get(String(id)) ?? null,
  users: ({ role }) =>
    Array.from(users.values()).filter((u) => !role || u.role === role),
  post: ({ id }) => decoratePost(posts.get(String(id))),
  createPost: ({ input }) => {
    if (!users.has(String(input.authorId))) {
      throw new Error(`Unknown authorId "${input.authorId}"`);
    }
    const post = {
      id: `p${nextPostId++}`,
      title: input.title,
      body: input.body,
      authorId: input.authorId,
      publishedAt: new Date().toISOString(),
    };
    posts.set(post.id, post);
    return decoratePost(post);
  },
};

function decoratePost(post) {
  if (!post) return null;
  return { ...post, author: users.get(post.authorId) };
}

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || new URL(req.url, "http://x").pathname !== "/graphql") {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }

  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", async () => {
    let body;
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ errors: [{ message: "Invalid JSON body" }] }));
      return;
    }

    const result = await graphql({
      schema,
      source: body.query,
      rootValue: root,
      variableValues: body.variables,
      operationName: body.operationName,
    });

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(result));
  });
});

const port = process.env.PORT ?? 4100;
server.listen(port, () =>
  console.log(`[graphql] listening on http://127.0.0.1:${port}/graphql`),
);
