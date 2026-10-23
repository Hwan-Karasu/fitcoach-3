interface Request { readonly identifier: string; readonly content: { readonly data?: unknown } }
interface Notification { readonly request: Request }
interface Port {
  scheduled(): Promise<readonly Request[]>;
  presented(): Promise<readonly Notification[]>;
  response(): Promise<{ readonly notification: Notification } | null>;
  cancel(id: string): Promise<void>;
  dismiss(id: string): Promise<void>;
  clearResponse(): Promise<void>;
}
const owned = (request: Request): boolean => {
  const data = request.content.data;
  return data !== null && typeof data === "object" && "kind" in data && data.kind === "rest-timer";
};
/** Imported signal IDs are never trusted. Enumerate the OS's own requests and preserve
 * calendar/other kinds, including a launch response that belongs to another feature. */
export async function clearRestSignals(port: Port): Promise<void> {
  const settle = async (tasks: readonly Promise<void>[]): Promise<void> => {
    const done = await Promise.allSettled(tasks);
    if (done.some((result) => result.status === "rejected")) throw new Error("REST_SIGNALS_UNAVAILABLE");
  };
  const results = await Promise.allSettled([
    port.scheduled().then((items) => settle(items.filter(owned).map((item) => port.cancel(item.identifier)))),
    port.presented().then((items) => settle(items.filter((item) => owned(item.request)).map((item) => port.dismiss(item.request.identifier)))),
    port.response().then(async (response) => { if (response !== null && owned(response.notification.request)) await port.clearResponse(); }),
  ]);
  if (results.some((result) => result.status === "rejected")) throw new Error("REST_SIGNALS_UNAVAILABLE");
}
