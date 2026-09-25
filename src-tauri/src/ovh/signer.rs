//! Signature des requêtes OVHcloud.
//!
//! Formule officielle (doc « First steps with the OVHcloud API ») :
//!
//! ```text
//! "$1$" + SHA1_HEX(AS + "+" + CK + "+" + METHOD + "+" + URL + "+" + BODY + "+" + TSTAMP)
//! ```
//!
//! Deux pièges vérifiés dans le SDK officiel `python-ovh` :
//! - `URL` est l'**URL complète** effectivement appelée (schéma, hôte, branche,
//!   chemin, query string), pas seulement la query string comme le laisse croire
//!   le nom du champ dans la doc ;
//! - `BODY` est le corps sérialisé **octet pour octet** tel qu'il sera envoyé —
//!   d'où la sérialisation une seule fois, réutilisée pour la signature et l'envoi.
//!   Une requête sans corps signe la chaîne vide.

use sha1::{Digest, Sha1};

pub const SIGNATURE_PREFIX: &str = "$1$";

pub fn sign(
    application_secret: &str,
    consumer_key: &str,
    method: &str,
    url: &str,
    body: &str,
    timestamp: i64,
) -> String {
    let mut hasher = Sha1::new();
    hasher.update(
        [
            application_secret,
            consumer_key,
            &method.to_uppercase(),
            url,
            body,
            &timestamp.to_string(),
        ]
        .join("+")
        .as_bytes(),
    );
    format!("{SIGNATURE_PREFIX}{}", hex::encode(hasher.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Vecteur de contrôle : SHA-1 de la chaîne jointe, calculé indépendamment.
    #[test]
    fn signature_matches_reference_vector() {
        let got = sign(
            "secret",
            "ck",
            "GET",
            "https://eu.api.ovh.com/v1/domain",
            "",
            1_700_000_000,
        );
        let expected_input = "secret+ck+GET+https://eu.api.ovh.com/v1/domain++1700000000";
        let mut h = Sha1::new();
        h.update(expected_input.as_bytes());
        assert_eq!(got, format!("$1${}", hex::encode(h.finalize())));
        assert!(got.starts_with("$1$"));
        assert_eq!(got.len(), 3 + 40);
    }

    #[test]
    fn method_is_uppercased_and_empty_body_is_empty_string() {
        assert_eq!(
            sign("s", "c", "get", "u", "", 1),
            sign("s", "c", "GET", "u", "", 1)
        );
    }
}

#[cfg(test)]
mod cross_check {
    use super::*;

    /// Comparaison avec la valeur produite par le SDK officiel `python-ovh`
    /// pour les mêmes entrées (corps JSON compact, URL complète).
    #[test]
    fn matches_python_ovh_sdk() {
        let got = sign(
            "AS_test_secret",
            "CK_test_consumer",
            "POST",
            "https://eu.api.ovh.com/v1/domain/zone/example.com/record",
            r#"{"fieldType":"A","subDomain":"www","target":"192.0.2.1","ttl":3600}"#,
            1_758_729_600,
        );
        assert_eq!(got, include_str!("../../tests/sig_expected.txt").trim());
    }
}
