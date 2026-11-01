import { createContext, useContext } from "react";
import type { Account, Permission } from "../../../modules/contracts/index.ts";

/** The signed-in account, for what its role lets it see and do. */
export const AccountContext = createContext<Account | null>(null);
/** Whether the signed-in account's role allows `permission`. */
export function useCan() {
  const account = useContext(AccountContext);
  return (permission: Permission) =>
    !!account?.permissions.includes(permission);
}
