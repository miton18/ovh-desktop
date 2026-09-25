//! Modèles de la section `/me` — pour l'instant, les contacts.
//!
//! Transcrit depuis `https://eu.api.ovh.com/v1/me.json` (`me.contact.Contact`).
//!
//! C'est **ici** que vivent les données personnelles d'un contact, et pas dans
//! la section `/domain` : celle-ci ne porte que des identifiants, et le schéma
//! le dit explicitement — « contact data can be edited via `/me/contact/<ID>` ».

use serde::{Deserialize, Serialize};

use super::common::{CountryCode, OvhDate, PhoneNumber};
use super::domain::{Gender, Language, LegalForm};

/// `contact.Address`
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeContactAddress {
    pub line1: String,
    pub line2: Option<String>,
    pub line3: Option<String>,
    pub zip: String,
    pub city: String,
    pub province: Option<String>,
    pub country: CountryCode,
    pub other_details: Option<String>,
}

/// `me.contact.Contact` — la fiche complète d'un contact.
///
/// Contrairement à `domain.Contact`, l'essentiel n'est pas nullable ici :
/// `firstName`, `lastName` et `email` sont toujours renseignés. C'est ce qui
/// permet d'afficher un nom lisible là où le domaine ne donne qu'un numéro.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeContact {
    pub id: i64,
    pub first_name: String,
    pub last_name: String,
    pub email: String,
    pub language: Language,
    pub legal_form: LegalForm,
    pub address: MeContactAddress,

    pub organisation_name: Option<String>,
    pub organisation_type: Option<String>,
    pub gender: Option<Gender>,
    pub phone: Option<PhoneNumber>,
    pub cell_phone: Option<PhoneNumber>,
    pub fax: Option<PhoneNumber>,
    pub spare_email: Option<String>,

    pub birth_day: Option<OvhDate>,
    pub birth_city: Option<String>,
    pub birth_zip: Option<String>,
    pub birth_country: Option<CountryCode>,
    pub nationality: Option<CountryCode>,

    pub vat: Option<String>,
    pub national_identification_number: Option<String>,
    pub company_national_identification_number: Option<String>,
}

impl MeContact {
    /// Ce qu'on affiche pour nommer ce contact en une ligne.
    ///
    /// Une organisation prime sur la personne : sur un domaine professionnel,
    /// c'est elle que le propriétaire attend de lire.
    pub fn display_name(&self) -> String {
        if let Some(org) = self.organisation_name.as_deref() {
            let org = org.trim();
            if !org.is_empty() {
                return org.to_owned();
            }
        }
        let name = format!("{} {}", self.first_name.trim(), self.last_name.trim());
        let name = name.trim();
        if name.is_empty() {
            self.email.clone()
        } else {
            name.to_owned()
        }
    }
}
