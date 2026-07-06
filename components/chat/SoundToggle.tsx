/**
 * SoundToggle.tsx
 * Mute / unmute button — purely presentational.
 */
import { Button } from "@/components/ui/button";
import { Volume2, VolumeX } from "lucide-react";

interface Props {
  enabled: boolean;
  onToggle: () => void;
}

export default function SoundToggle({ enabled, onToggle }: Props) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8 text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-50 cursor-pointer"
      onClick={onToggle}
      title={enabled ? "Mute sounds" : "Unmute sounds"}
      aria-label={enabled ? "Mute sounds" : "Unmute sounds"}
    >
      {enabled ? (
        <Volume2 className="h-4 w-4" />
      ) : (
        <VolumeX className="h-4 w-4 text-destructive" />
      )}
    </Button>
  );
}
