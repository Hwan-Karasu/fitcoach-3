/** Pop to the existing root, select Clients/Roster, and retain that root's key and tab state.
 * POP_TO is handled by the normal stack router, including beforeRemove protections.
 */
export function clientsListAction() {
  return { type: "POP_TO", payload: { name: "Root", params: { screen: "Clients", params: { screen: "Roster" } }, merge: true } } as const;
}
