import { solveBoard } from "./ddsAnalysis.js";

type Request = Parameters<typeof solveBoard>[0] & { id: number };
self.addEventListener("message", (event: MessageEvent<Request>) => {
  const request = event.data;
  void solveBoard(request).then((baseline) => {
    self.postMessage({ id: request.id, baseline });
  }).catch((error: unknown) => {
    self.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) });
  });
});
