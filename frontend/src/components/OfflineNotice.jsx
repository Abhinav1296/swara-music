import { ArrowDownToLine, CloudOff } from "lucide-react";
import { useRouter } from "../context/RouterContext";

/**
 * Shown in place of the network-only pages (Home, Albums) when the device is
 * offline. Points the user to the two things that DO work with no connection —
 * their Downloads and imported Local Files, both living in Library.
 */
export default function OfflineNotice({ title = "You're offline" }) {
  const { navigate } = useRouter();
  return (
    <div className="pt-2">
      <div className="glass mt-6 flex flex-col items-center gap-4 rounded-3xl px-6 py-16 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent/15">
          <CloudOff size={30} className="text-accent" />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-white">{title}</h1>
          <p className="mx-auto mt-2 max-w-sm text-sm text-white/50">
            No internet right now. Your <span className="text-white/80">Downloads</span> and{" "}
            <span className="text-white/80">Local Files</span> are saved on this device — keep
            the music going from Library.
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate("library")}
          className="btn-glossy inline-flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
        >
          <ArrowDownToLine size={18} />
          Downloads &amp; Local Files
        </button>
      </div>
    </div>
  );
}
