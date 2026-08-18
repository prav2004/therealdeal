/*
 * Pickr — shared product rules (single source of truth).
 *
 * Loaded as a classic script; exposes window.PickrProductRules.
 * Use these facts to keep wording consistent and compliant across the site:
 * Pickr is a FREE-TO-PLAY sports PREDICTION PRACTICE platform. Virtual tokens
 * only. No cash value, no deposits, no withdrawals, no payouts, not a sportsbook.
 */
(function (global) {
  var productRules = {
    brandName: "Pickr",
    legalName: "Pickr Technologies Inc.", // TODO: confirm exact registered legal name (legal review)
    market: "Canada",
    minimumAge: 19,
    freeToPlay: true,
    usesVirtualTokens: true,
    tokensHaveCashValue: false,
    acceptsDeposits: false,
    processesWagers: false,
    paysUsers: false,
    offersCashPrizes: false,
    supportsWithdrawals: false,
    isSportsbook: false,
    purpose: "Sports prediction practice and entertainment",

    // Approved reusable copy
    copy: {
      primaryDescription:
        "Pickr is a free-to-play sports prediction platform where users can practise making picks using virtual tokens.",
      supportingDescription:
        "Build your sports knowledge, test your predictions, and track your performance without depositing or risking real money.",
      partnerExplanation:
        "When you feel ready, you can explore optional offers from licensed betting partners. Partner websites are separate from Pickr, and their eligibility requirements, terms, and responsible-gambling rules apply.",
      tokenExplanation:
        "Pickr Tokens are virtual practice credits with no cash value. They cannot be purchased, withdrawn, transferred, or exchanged for money or prizes.",
      shortDisclaimer:
        "Free-to-play. Virtual tokens only. No cash value. No deposits or withdrawals on Pickr. 19+.",
      partnerDisclosure:
        "Pickr is free-to-play and does not accept wagers or deposits. Partner offers are optional and take place on separate third-party websites. Pickr may receive compensation for qualifying referrals. Eligibility, location restrictions, and partner terms apply.",
      practicePickNote:
        "Practice pick using virtual tokens. No real money is wagered."
    }
  };

  if (global) global.PickrProductRules = productRules;
  if (typeof module !== "undefined" && module.exports) module.exports = { productRules };
})(typeof window !== "undefined" ? window : this);
