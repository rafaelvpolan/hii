// Teto de tempo para teste que dirige o pipeline de card com git DE VERDADE
// (worktree, commit, push num remoto local).
//
// Por que existe: o default do Bun e 5000ms, o que basta com folga quando esses
// testes rodam isolados — finish-cost inteiro leva ~750ms sozinho. Na suite
// completa, porem, dezenas de subprocessos git disputam disco e CPU ao mesmo
// tempo e o mesmo teste chega a 5006ms. O resultado era um flake em ~1 de cada
// 3 rodadas, e pior que a reprovacao em si: o teste estourado continuava
// rodando e batia num stub de guarda, virando "Unhandled error between tests"
// num arquivo QUALQUER da suite. O sintoma escondia a causa.
//
// 60s nao e "desligar o teto" — e um teto compativel com o trabalho real. Clones,
// commits e reajustes continuam com limite, mas nao competem com a latencia do
// disco ou com a inicializacao do runtime para virar um falso timeout.
export const TEMPO_COM_GIT_MS = 60_000
