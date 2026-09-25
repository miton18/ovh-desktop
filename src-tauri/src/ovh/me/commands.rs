//! Commandes Tauri de la section `/me`.

use futures::stream::{self, StreamExt, TryStreamExt};
use tauri::State;

use super::api;
use crate::ovh::blocking;
use crate::ovh::commands::OvhState;
use crate::ovh::credentials::{self, Credentials};
use crate::ovh::error::{OvhError, OvhResult};
use crate::ovh::models::me::MeContact;

/// Même borne que pour les listes de la section domaine : au-delà, l'API répond 429.
const FAN_OUT: usize = 8;

async fn creds(state: &OvhState) -> OvhResult<Credentials> {
    let endpoint = state.client.endpoint();
    let account_id = state.active_account().map(|a| a.id);
    let creds = blocking(move || credentials::resolve(endpoint, account_id.as_deref())).await?;
    if !creds.is_complete() {
        return Err(OvhError::NotConfigured);
    }
    Ok(creds)
}

#[tauri::command]
pub async fn me_contact_get(state: State<'_, OvhState>, contact_id: i64) -> OvhResult<MeContact> {
    api::get_contact(&state.client, &creds(state.inner()).await?, contact_id).await
}

/// Résout plusieurs contacts d'un coup.
///
/// Un domaine en référence quatre — propriétaire, administratif, facturation,
/// technique — et l'interface les affiche ensemble. Les résoudre un par un
/// depuis le frontend ferait quatre allers-retours en série pour une seule
/// carte ; ici c'est un seul appel, parallélisé côté Rust.
///
/// Les identifiants introuvables sont simplement absents du résultat : un
/// contact inaccessible ne doit pas faire échouer l'affichage des trois autres.
#[tauri::command]
pub async fn me_contacts_resolve(
    state: State<'_, OvhState>,
    contact_ids: Vec<i64>,
) -> OvhResult<Vec<MeContact>> {
    let creds = creds(state.inner()).await?;

    let mut unique: Vec<i64> = contact_ids;
    unique.sort_unstable();
    unique.dedup();

    // Emprunts partagés capturés une fois : le `stream` ne peut pas déplacer
    // `state` dans chacune de ses fermetures.
    let client = &state.client;
    let creds = &creds;

    let resolved: Vec<Option<MeContact>> = stream::iter(unique.into_iter().map(|id| {
        async move {
            match api::get_contact(client, creds, id).await {
                Ok(contact) => Ok(Some(contact)),
                // 403 et 404 sont attendus : un contact peut appartenir à un
                // autre compte, ou avoir été supprimé.
                Err(OvhError::Api {
                    status: 403 | 404, ..
                }) => Ok(None),
                Err(e) => Err(e),
            }
        }
    }))
    .buffered(FAN_OUT)
    .try_collect()
    .await?;

    Ok(resolved.into_iter().flatten().collect())
}

#[tauri::command]
pub async fn me_contacts_list(state: State<'_, OvhState>) -> OvhResult<Vec<i64>> {
    api::list_contacts(&state.client, &creds(state.inner()).await?).await
}

#[tauri::command]
pub async fn me_contact_update(
    state: State<'_, OvhState>,
    contact_id: i64,
    contact: MeContact,
) -> OvhResult<MeContact> {
    api::update_contact(
        &state.client,
        &creds(state.inner()).await?,
        contact_id,
        &contact,
    )
    .await
}
