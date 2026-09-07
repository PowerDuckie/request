import runtime from "postman-runtime";
import pkg from "postman-collection";

const { Collection } = pkg;

const collection = new Collection({
  item: [
    {
      name: "sse probe",
      request: {
        method: "GET",
        header: [{ key: "Accept", value: "text/event-stream" }],
        url: "http://cc.apipost.cc:6002/sse",
      },
    },
  ],
});

new runtime.Runner().run(
  collection,
  { timeout: { request: 15000 } },
  (err, run) => {
    if (err) throw err;
    run.start({
      responseStart(err, cursor, response) {
        console.log("[responseStart]", response && response.code);
      },
      responseData(cursor, data) {
        console.log("[responseData]", JSON.stringify(data.toString("utf8")));
      },
      response(err, cursor, response) {
        console.log(
          "[response] body length:",
          response && response.stream && response.stream.length,
        );
      },
      done(err) {
        console.log("[done]", err || "ok");
      },
    });
  },
);
