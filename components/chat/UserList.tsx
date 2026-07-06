/**
 * UserList.tsx
 * Online users panel — purely presentational.
 */
import { Badge } from "@/components/ui/badge";
import type { ChatUser } from "@/types/chat";

interface Props {
  users: ChatUser[];
  socketId: string;
}

export default function UserList({ users, socketId }: Props) {
  return (
    <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-3 bg-zinc-50/50 dark:bg-zinc-900/50">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
        </span>
        <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
          Online ({users.length})
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5 max-h-16 overflow-y-auto pt-0.5">
        {users.map((user) => {
          const isSelf = user.id === socketId;
          return (
            <Badge
              key={user.id}
              variant={isSelf ? "default" : "outline"}
              className={`text-[10px] px-2 py-0.5 font-mono transition-colors ${
                isSelf
                  ? "bg-emerald-500 text-white hover:bg-emerald-600"
                  : "text-zinc-500 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700"
              }`}
            >
              {isSelf ? `You (${user.username})` : user.username}
            </Badge>
          );
        })}
      </div>
    </div>
  );
}
