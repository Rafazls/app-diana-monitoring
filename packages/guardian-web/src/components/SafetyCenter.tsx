/**
 * Central de apoio — o que fazer quando o alerta assusta.
 *
 * Um alerta sem caminho de ação deixa o responsável pior do que estava. Estes
 * canais são públicos e gratuitos no Brasil.
 */
const CHANNELS = [
  {
    name: "Disque 100",
    detail: "Direitos Humanos — denúncia de violência contra crianças e adolescentes. 24h, gratuito.",
  },
  {
    name: "CVV · 188",
    detail: "Apoio emocional e prevenção do suicídio. 24h, gratuito e sigiloso.",
  },
  {
    name: "SaferNet",
    detail: "Orientação sobre crimes e riscos na internet (new.safernet.org.br).",
  },
  {
    name: "Conselho Tutelar",
    detail: "Órgão local de proteção da criança e do adolescente do seu município.",
  },
];

const GUIDANCE = [
  "Converse sem culpar a criança — quem se sente culpado esconde o próximo episódio.",
  "Preserve as evidências (capturas de tela) antes de bloquear ou apagar qualquer coisa.",
  "Bloqueie o contato e denuncie o perfil dentro da própria plataforma.",
  "Se houver ameaça, exposição de imagem ou risco à integridade, registre boletim de ocorrência.",
];

export function SafetyCenter() {
  return (
    <section>
      <div className="panel">
        <h3 className="panel__title">Canais de apoio</h3>
        <ul className="channels">
          {CHANNELS.map((channel) => (
            <li key={channel.name} className="channel">
              <strong>{channel.name}</strong>
              <p>{channel.detail}</p>
            </li>
          ))}
        </ul>
      </div>

      <div className="panel">
        <h3 className="panel__title">Orientações gerais</h3>
        <ul className="guidance">
          {GUIDANCE.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
