//! Modèles de données OVHcloud, transcrits depuis les schémas officiels
//! (`https://eu.api.ovh.com/v1/<section>.json`).
//!
//! Règles de transcription appliquées, valables pour toute future section :
//! - `canBeNull: true` → `Option<T>`. C'est `canBeNull` qui décide, jamais
//!   `required` (qui ne concerne que les paramètres d'opération).
//! - `readOnly` → champ présent dans le modèle de lecture, absent des payloads
//!   d'écriture, qui sont des types distincts (`RecordCreate` vs `Record`).
//! - Les enums passent par [`ovh_enum!`], qui préserve les valeurs inconnues.
//! - Les scalaires datés et réseau restent des `String` : voir [`common`].

// Les modèles décrivent le contrat de l'API ; ils sont volontairement complets
// avant que la couche d'appel et l'interface ne les consomment.
#![allow(dead_code)]

pub mod common;
pub mod domain;
pub mod hosting;
pub mod me;

mod enum_macro;
pub(crate) use enum_macro::ovh_enum;
