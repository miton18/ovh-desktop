/// Déclare un enum OVH tolérant aux valeurs inconnues.
///
/// Le corpus de schémas montre que les enums OVH gagnent des valeurs sans
/// préavis, et qu'une même enum peut avoir plus de valeurs dans une section que
/// dans une autre (`service.RenewalTypeEnum` gagne `automaticV2024` selon la
/// section, `nichandle.OvhSubsidiaryEnum` vaut 16 valeurs ici et 25 là).
/// Un enum serde classique ferait échouer la désérialisation de **toute** la
/// réponse sur une valeur nouvelle ; la variante `Other` la conserve telle
/// quelle, ce qui permet de l'afficher au lieu de tout perdre.
macro_rules! ovh_enum {
    (
        $(#[$meta:meta])*
        $name:ident { $( $variant:ident => $wire:literal ),+ $(,)? }
    ) => {
        $(#[$meta])*
        #[derive(Debug, Clone, PartialEq, Eq, Hash)]
        pub enum $name {
            $( $variant, )+
            /// Valeur absente du schéma au moment de la génération.
            Other(String),
        }

        impl $name {
            /// Valeur telle qu'elle circule sur le réseau.
            pub fn as_wire(&self) -> &str {
                match self {
                    $( Self::$variant => $wire, )+
                    Self::Other(raw) => raw.as_str(),
                }
            }

            pub fn from_wire(raw: &str) -> Self {
                match raw {
                    $( $wire => Self::$variant, )+
                    other => Self::Other(other.to_owned()),
                }
            }

            /// Les valeurs connues au moment de la génération.
            pub fn known() -> &'static [&'static str] {
                &[ $( $wire, )+ ]
            }
        }

        impl std::fmt::Display for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str(self.as_wire())
            }
        }

        impl serde::Serialize for $name {
            fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
                s.serialize_str(self.as_wire())
            }
        }

        impl<'de> serde::Deserialize<'de> for $name {
            fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
                Ok(Self::from_wire(&String::deserialize(d)?))
            }
        }
    };
}

pub(crate) use ovh_enum;
