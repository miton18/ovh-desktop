//! Appels à la section `/me` de l'API OVHcloud.

use reqwest::Method;

use crate::ovh::client::OvhClient;
use crate::ovh::credentials::Credentials;
use crate::ovh::error::OvhResult;
use crate::ovh::models::me::MeContact;

pub async fn list_contacts(client: &OvhClient, creds: &Credentials) -> OvhResult<Vec<i64>> {
    client
        .call(creds, Method::GET, "/me/contact", None::<&()>)
        .await
}

/// La fiche d'un contact, par son identifiant.
///
/// C'est la seule route qui donne un nom lisible : un domaine ne porte que des
/// identifiants numériques pour ses quatre contacts.
pub async fn get_contact(
    client: &OvhClient,
    creds: &Credentials,
    contact_id: i64,
) -> OvhResult<MeContact> {
    client
        .call(
            creds,
            Method::GET,
            &format!("/me/contact/{contact_id}"),
            None::<&()>,
        )
        .await
}

pub async fn update_contact(
    client: &OvhClient,
    creds: &Credentials,
    contact_id: i64,
    contact: &MeContact,
) -> OvhResult<MeContact> {
    client
        .call(
            creds,
            Method::PUT,
            &format!("/me/contact/{contact_id}"),
            Some(contact),
        )
        .await
}
