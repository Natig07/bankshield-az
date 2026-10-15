import type { VerificationStatus } from "@/lib/domain/enums";

// Metadata for the three official starting sources. See REGULATORY_SOURCES.md.
//
// IMPORTANT: no source is verified. These URLs were retrieved through an automated
// summarizer, not checked by a human against the official record. Decision numbers,
// effective dates and amendments are deliberately NOT stored here until confirmed.
// This registry carries no clause text.

export interface RegulatorySourceMeta {
  code: string;
  title: string;
  issuer: string;
  url: string;
  retrievedLanguage: "az" | "en";
  verificationStatus: VerificationStatus;
}

export const REGULATORY_SOURCES: readonly RegulatorySourceMeta[] = [
  {
    code: "CBA-ISM-2021",
    title: "Regulations on Information Security Management in Banks",
    issuer: "Central Bank of the Republic of Azerbaijan",
    url: "https://www.cbar.az/law-370/regulations-on-information-security-management-in-banks?language=en",
    retrievedLanguage: "en",
    verificationStatus: "PENDING_VERIFICATION",
  },
  {
    code: "CBA-ISR-2024",
    title: "Information Security Requirements for Supervised Entities in Financial Markets",
    issuer: "Central Bank of the Republic of Azerbaijan",
    url: "https://uploads.cbar.az/assets/Information%20security%20requirements%20for%20supervised%20entities%20in%20financial%20markets%20.pdf",
    retrievedLanguage: "en",
    verificationStatus: "PENDING_VERIFICATION",
  },
  {
    code: "AZ-LAW-PERSONAL-DATA",
    title: "Law on Personal Data (Fərdi məlumatlar haqqında)",
    issuer: "Republic of Azerbaijan",
    url: "https://frameworks.e-qanun.az/19/c_f_19675.html",
    retrievedLanguage: "az",
    verificationStatus: "PENDING_VERIFICATION",
  },
];
