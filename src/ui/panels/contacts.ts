/**
 * Onglet « Contacts » — les quatre rôles WHOIS du domaine.
 *
 * Deux faits de l'API décident de l'écran :
 *
 * - **le domaine ne porte que des identifiants de contact.** Les données
 *   personnelles vivent dans `/me/contact`, qu'on ne lit ici que pour mettre un
 *   nom sur un identifiant. Rien n'est inventé quand le compte ne connaît pas
 *   le contact : on affiche l'identifiant brut ;
 * - **`changeContact` ne touche pas le propriétaire.** Le changement de
 *   titulaire est une procédure de trade chez le registre. Le rôle est donc
 *   affiché sans action, avec l'explication — pas masqué.
 */

import type { ChangeContact } from "../../ovh-api";
import { changeContacts, contactNameOf, describeFailure, nicHandleOf } from "../data";
import { button, el } from "../dom";
import { toast, toastError } from "../toast";
import type { DomainContext } from "./context";
import { isValidNicHandle, type ContactRole } from "./state";

type RoleDescriptor = {
  key: "owner" | ContactRole;
  label: string;
  hint: string;
};

const ROLES: RoleDescriptor[] = [
  { key: "owner", label: "Propriétaire", hint: "Titulaire du domaine" },
  { key: "admin", label: "Administratif", hint: "Décide pour le domaine" },
  { key: "tech", label: "Technique", hint: "Reçoit les alertes techniques" },
  { key: "billing", label: "Facturation", hint: "Reçoit les factures" },
];

const ROLE_IN_SENTENCE: Record<ContactRole, string> = {
  admin: "administratif",
  tech: "technique",
  billing: "de facturation",
};

export function renderContactsTab(ctx: DomainContext): HTMLElement {
  return el("section", { attrs: { "aria-label": "Contacts du domaine" } }, [
    el("div", { class: "stack" }, ROLES.map((role) => renderRow(ctx, role))),
  ]);
}

function contactIdOf(ctx: DomainContext, key: RoleDescriptor["key"]): string {
  const s = ctx.bundle.service;
  switch (key) {
    case "owner":
      return s.contactOwner.id;
    case "admin":
      return s.contactAdmin.id;
    case "tech":
      return s.contactTech.id;
    case "billing":
      return s.contactBilling.id;
  }
}

function renderRow(ctx: DomainContext, role: RoleDescriptor): HTMLElement {
  const { bundle, state } = ctx;
  const contactId = contactIdOf(ctx, role.key);
  const name = contactNameOf(bundle, contactId);
  const nic = nicHandleOf(bundle, contactId) ?? contactId;
  const editing = role.key !== "owner" && state.contactEdit?.role === role.key;
  const busy = state.busy.has(`contact:${role.key}`);

  const cells: (Node | null)[] = [
    el("div", { class: "ct-role" }, [
      el("span", { text: role.label }),
      el("span", { text: role.hint }),
    ]),
  ];

  if (editing && state.contactEdit) {
    cells.push(renderEditor(ctx, role.key as ContactRole));
  } else {
    cells.push(
      el("div", { class: "ct-value" }, [
        el("span", { text: name ?? nic }),
        el("span", { class: "ct-nic", text: nic }),
      ]),
    );
  }

  if (busy) {
    cells.push(
      el("span", { class: "section-note", text: "Changement en attente de validation" }),
    );
  } else if (role.key === "owner") {
    cells.push(
      el("span", {
        class: "ct-owner-note",
        text: "Le propriétaire ne se change pas ici : c'est une procédure de changement de titulaire auprès du registre.",
      }),
    );
  } else if (!editing) {
    cells.push(
      button("Changer", {
        class: "btn btn-secondary",
        onClick: () => {
          state.contactEdit = { role: role.key as ContactRole, value: "" };
          ctx.rerender();
          const input = document.querySelector<HTMLInputElement>(".ct-edit input");
          input?.focus();
        },
      }),
    );
  }

  return el("div", { class: "ct-row" }, cells);
}

function renderEditor(ctx: DomainContext, role: ContactRole): HTMLElement {
  const { bundle, state } = ctx;

  const saveBtn = button("Demander", {
    class: "btn btn-primary",
    disabled: true,
    onClick: () => void submit(),
  });

  const input = el("input", {
    class: "input",
    attrs: {
      type: "text",
      placeholder: "identifiant-ovh",
      "aria-label": `Nouveau contact ${ROLE_IN_SENTENCE[role]}`,
      spellcheck: "false",
      autocomplete: "off",
      value: state.contactEdit?.value ?? "",
    },
    on: {
      input: (ev) => {
        const value = (ev.currentTarget as HTMLInputElement).value;
        if (state.contactEdit) state.contactEdit.value = value;
        saveBtn.disabled = !isValidNicHandle(value);
      },
      keydown: (ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          void submit();
        } else if (ev.key === "Escape") {
          ev.preventDefault();
          cancel();
        }
      },
    },
  });

  function cancel(): void {
    state.contactEdit = null;
    ctx.rerender();
  }

  /**
   * `changeContact` prend les **trois** rôles : celui qu'on change et les deux
   * autres inchangés. Omettre un rôle reviendrait à le réinitialiser.
   */
  async function submit(): Promise<void> {
    const value = state.contactEdit?.value.trim().toLowerCase() ?? "";
    if (!isValidNicHandle(value)) return;

    const info = bundle.serviceInfo;
    const current: ChangeContact = {
      contactAdmin: info?.contactAdmin ?? bundle.service.contactAdmin.id,
      contactBilling: info?.contactBilling ?? bundle.service.contactBilling.id,
      contactTech: info?.contactTech ?? bundle.service.contactTech.id,
    };
    const payload: ChangeContact = { ...current };
    if (role === "admin") payload.contactAdmin = value;
    if (role === "tech") payload.contactTech = value;
    if (role === "billing") payload.contactBilling = value;

    state.contactEdit = null;
    state.busy.add(`contact:${role}`);
    ctx.rerender();

    try {
      await changeContacts(bundle.name, payload);
      // La demande devient une tâche : le suivi appartient à l'onglet
      // Opérations, pas à un drapeau local qui resterait allumé pour toujours.
      state.busy.delete(`contact:${role}`);
      toast(`Demande envoyée à ${value}. Le contact doit la valider.`);
      ctx.reload({ force: true });
      ctx.trackTasks();
    } catch (e) {
      state.busy.delete(`contact:${role}`);
      toastError(describeFailure(e).message);
      ctx.rerender();
    }
  }

  saveBtn.disabled = !isValidNicHandle(state.contactEdit?.value ?? "");

  return el("div", { class: "ct-edit" }, [
    input,
    saveBtn,
    button("Annuler", { class: "btn btn-secondary", onClick: cancel }),
  ]);
}
