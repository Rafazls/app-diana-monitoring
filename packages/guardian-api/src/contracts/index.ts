/**
 * Ponte para o contrato compartilhado do monorepo.
 *
 * No repositório original estes tipos eram uma cópia vendorizada do núcleo
 * (com a nota "até existir o pacote @diana/contracts"). No monorepo o pacote
 * existe — então este arquivo vira uma reexportação fina, e o restante do
 * serviço segue importando `../contracts/index.js` sem mudar uma linha.
 */
export * from "@diana/contracts";
