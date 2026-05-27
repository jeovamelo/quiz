import { useState } from "react";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Trophy,
  Power,
  Settings,
  ScanLine,
} from "lucide-react";
import { haptic } from "@/hooks/use-haptic";

type Props = {
  showRanking: boolean;
  onToggleRanking: () => void;
  onShowGiantQr: () => void;
  onEndSession: () => void;
};

export function RemoteDrawer({
  showRanking,
  onToggleRanking,
  onShowGiantQr,
  onEndSession,
}: Props) {
  const [confirmEnd, setConfirmEnd] = useState(false);

  return (
    <>
      <Drawer>
        <DrawerTrigger asChild>
          <button
            type="button"
            onClick={() => haptic(25)}
            aria-label="Outras Funcionalidades"
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-[#3A4255] bg-[#1E2235] text-sm font-bold text-[#9CA3AF] transition-all duration-100 active:scale-95 active:bg-[#262D3D] hover:text-white"
          >
            <Settings className="h-4 w-4" /> Outras Funcionalidades ⚙️
          </button>
        </DrawerTrigger>
        <DrawerContent className="border-t border-[#262D3D] bg-[#0E1015] text-white">
          <DrawerHeader>
            <DrawerTitle className="text-white">
              Outras Funcionalidades
            </DrawerTitle>
            <DrawerDescription className="text-[#9CA3AF]">
              Controle a projeção sem sair do controle remoto.
            </DrawerDescription>
          </DrawerHeader>

          <div className="space-y-2 px-4 pb-2">
            <ToggleRow
              icon={<Trophy className="h-5 w-5" />}
              label="Exibir Classificação"
              hint="Mostra/oculta o ranking parcial"
              active={showRanking}
              onToggle={onToggleRanking}
            />
            <button
              type="button"
              onClick={() => {
                haptic(35);
                onShowGiantQr();
              }}
              className="flex w-full items-center gap-3 rounded-xl border border-[#F68B1F]/60 bg-gradient-to-br from-[#F68B1F]/15 to-[#A6193C]/15 px-4 py-3 text-left transition active:scale-[0.98]"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#A6193C] to-[#F68B1F] text-white">
                <ScanLine className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-white">
                  Exibir QR Code Gigante 🎯
                </span>
                <span className="block text-[11px] text-[#9CA3AF]">
                  Mostra um QR enorme no projetor sobre o slide atual
                </span>
              </span>
            </button>
          </div>

          <DrawerFooter className="gap-2">
            <button
              type="button"
              onClick={() => {
                haptic(40);
                setConfirmEnd(true);
              }}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-500/60 bg-red-600/15 px-4 py-4 text-base font-extrabold uppercase tracking-wide text-red-300 transition active:scale-95 hover:bg-red-600/25"
            >
              <Power className="h-5 w-5" /> Encerrar Apresentação
            </button>
            <DrawerClose asChild>
              <button
                type="button"
                className="rounded-xl border border-[#3A4255] bg-[#1E2235] px-4 py-2.5 text-sm font-semibold text-[#9CA3AF] active:scale-95"
              >
                Fechar
              </button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      <AlertDialog open={confirmEnd} onOpenChange={setConfirmEnd}>
        <AlertDialogContent className="border-[#262D3D] bg-[#0E1015] text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">
              Deseja realmente encerrar o evento e revelar o pódio agora?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[#9CA3AF]">
              A apresentação será encerrada imediatamente no projetor e os
              campeões serão revelados na tela principal.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-[#262D3D] bg-transparent text-[#9CA3AF] hover:bg-[#1E2235] hover:text-white">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmEnd(false);
                onEndSession();
              }}
              className="bg-gradient-to-r from-[#A6193C] to-[#F68B1F] text-white hover:opacity-95"
            >
              Sim, revelar o pódio
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ToggleRow({
  icon,
  label,
  hint,
  active,
  onToggle,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        haptic(20);
        onToggle();
      }}
      aria-pressed={active}
      className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition active:scale-[0.98] ${
        active
          ? "border-[#07A684]/50 bg-[#07A684]/10"
          : "border-[#262D3D] bg-[#131722]"
      }`}
    >
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
          active ? "bg-[#07A684]/20 text-[#07A684]" : "bg-[#1E2235] text-[#9CA3AF]"
        }`}
        aria-hidden="true"
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-white">{label}</span>
        <span className="block text-[11px] text-[#9CA3AF]">{hint}</span>
      </span>
      <span
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
          active ? "bg-[#07A684]" : "bg-[#3A4255]"
        }`}
        aria-hidden="true"
      >
        <span
          className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
            active ? "translate-x-5" : ""
          }`}
        />
      </span>
    </button>
  );
}