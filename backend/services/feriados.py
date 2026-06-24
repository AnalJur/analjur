"""
Feriados nacionais e estaduais brasileiros + utilitários de dias úteis.

Feriados nacionais (Lei 10.607/2002 + Portaria MTE):
  1 jan, Sexta-feira Santa, Páscoa, 21 abr, 1 mai, Corpus Christi,
  7 set, 12 out, 2 nov, 15 nov, 20 nov, 25 dez.

Feriados estaduais: mapeados por sigla de UF (os mais comuns nos TJs).
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Optional


# ── Páscoa (Algoritmo de Meeus/Jones/Butcher) ────────────────────────────────

def _pascoa(ano: int) -> date:
    a = ano % 19
    b, c = divmod(ano, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    mes = (h + l - 7 * m + 114) // 31
    dia = ((h + l - 7 * m + 114) % 31) + 1
    return date(ano, mes, dia)


# ── Feriados nacionais ────────────────────────────────────────────────────────

def feriados_nacionais(ano: int) -> set[date]:
    pascoa = _pascoa(ano)
    sexta_santa = pascoa - timedelta(days=2)
    corpus_christi = pascoa + timedelta(days=60)

    return {
        date(ano, 1, 1),    # Confraternização Universal
        sexta_santa,        # Paixão de Cristo
        pascoa,             # Páscoa
        date(ano, 4, 21),   # Tiradentes
        date(ano, 5, 1),    # Dia do Trabalho
        corpus_christi,     # Corpus Christi
        date(ano, 9, 7),    # Independência
        date(ano, 10, 12),  # Nossa Senhora Aparecida
        date(ano, 11, 2),   # Finados
        date(ano, 11, 15),  # Proclamação da República
        date(ano, 11, 20),  # Consciência Negra (Lei 12.519/2011)
        date(ano, 12, 25),  # Natal
    }


# ── Feriados estaduais por UF ─────────────────────────────────────────────────
# Fontes: legislações estaduais compiladas (principais feriados de ponto facultativo
# e feriados estaduais de maior impacto nos TJs e TRFs).

_FERIADOS_UF: dict[str, list[tuple[int, int]]] = {
    "AC": [(1, 20), (6, 15), (9, 5)],          # Dia do Católico, Aniversário AC, Amazônia
    "AL": [(6, 24), (9, 16)],                   # São João, Emancipação AL
    "AM": [(9, 5), (11, 20)],                   # Elevação à Capitania, Consciência Negra AM
    "AP": [(3, 19), (9, 13)],                   # São José, Criação AP
    "BA": [(7, 2)],                             # Independência da Bahia
    "CE": [(3, 25)],                            # Data Magna CE
    "DF": [(4, 21)],                            # já no nacional, sem adicional relevante
    "ES": [(10, 28)],                           # Nossa Senhora da Penha
    "GO": [(10, 24)],                           # Pedra fundamental de Goiânia
    "MA": [(7, 28)],                            # Adesão à Independência MA
    "MG": [(4, 21)],                            # já no nacional
    "MS": [(10, 11)],                           # Criação MS
    "MT": [(11, 8)],                            # Proclamação MT
    "PA": [(8, 15)],                            # Adesão à Independência PA
    "PB": [(8, 5)],                             # Nossa Senhora das Neves
    "PE": [(3, 6)],                             # Revolução Pernambucana
    "PI": [(10, 19)],                           # Dia do Piauí
    "PR": [(12, 19)],                           # Emancipação PR
    "RJ": [(4, 23), (11, 20)],                  # São Jorge, Consciência Negra
    "RN": [(10, 3)],                            # Mártires de Cunhaú
    "RO": [(1, 4)],                             # Criação RO
    "RR": [(10, 5)],                            # Criação RR
    "RS": [(9, 20)],                            # Revolução Farroupilha
    "SC": [(8, 11)],                            # Nossa Senhora do Desterro
    "SE": [(7, 8)],                             # Emancipação SE
    "SP": [(7, 9)],                             # Revolução Constitucionalista
    "TO": [(10, 5), (10, 18)],                  # Criação TO, Dia da Cidade
}


def feriados_estaduais(ano: int, uf: Optional[str] = None) -> set[date]:
    if not uf:
        return set()
    uf = uf.upper().strip()
    datas = _FERIADOS_UF.get(uf, [])
    return {date(ano, mes, dia) for mes, dia in datas}


def todos_feriados(ano: int, uf: Optional[str] = None) -> set[date]:
    return feriados_nacionais(ano) | feriados_estaduais(ano, uf)


# ── Utilitários de dias úteis ─────────────────────────────────────────────────

def _is_feriado(d: date, cache: dict[int, set[date]], uf: Optional[str]) -> bool:
    ano = d.year
    if ano not in cache:
        cache[ano] = todos_feriados(ano, uf)
    return d in cache[ano]


def eh_dia_util(d: date, uf: Optional[str] = None) -> bool:
    """Retorna True se 'd' é dia útil (seg–sex, não feriado)."""
    cache: dict[int, set[date]] = {}
    return d.weekday() < 5 and not _is_feriado(d, cache, uf)


def proximo_dia_util(d: date, uf: Optional[str] = None) -> date:
    """Retorna 'd' se já for dia útil, ou o próximo dia útil seguinte."""
    cache: dict[int, set[date]] = {}
    while d.weekday() >= 5 or _is_feriado(d, cache, uf):
        d += timedelta(days=1)
    return d


def adicionar_dias_uteis(inicio: date, dias: int, uf: Optional[str] = None) -> date:
    """
    Adiciona 'dias' dias úteis a 'inicio'.
    Dia 0 = início (não conta o próprio dia); conforme CPC art. 219.
    """
    cache: dict[int, set[date]] = {}
    atual = inicio
    contados = 0
    while contados < dias:
        atual += timedelta(days=1)
        if atual.weekday() < 5 and not _is_feriado(atual, cache, uf):
            contados += 1
    return atual


def adicionar_dias_corridos(inicio: date, dias: int) -> date:
    """Adiciona 'dias' dias corridos (calendário) a 'inicio'."""
    return inicio + timedelta(days=dias)


def calcular_vencimento(
    data_base: date,
    prazo_dias: int,
    tipo: str = "uteis",
    uf: Optional[str] = None,
) -> date:
    """
    Calcula o vencimento de um prazo processual.

    tipo:
      "uteis"   → dias úteis (CPC art. 219; padrão para prazos processuais)
      "corridos" → dias corridos (calendário)
      "meses"   → meses corridos (ex: prazo de decadência/prescrição)

    Se o vencimento cair em feriado/fim-de-semana, prorroga para o próximo dia útil
    (CPC art. 224, § 1º).
    """
    if tipo == "uteis":
        venc = adicionar_dias_uteis(data_base, prazo_dias, uf)
    elif tipo == "corridos":
        venc = adicionar_dias_corridos(data_base, prazo_dias)
        # Prorroga se cair em não-útil
        venc = proximo_dia_util(venc, uf)
    elif tipo == "meses":
        mes = data_base.month + prazo_dias
        ano = data_base.year + (mes - 1) // 12
        mes = (mes - 1) % 12 + 1
        try:
            venc = data_base.replace(year=ano, month=mes)
        except ValueError:
            # Dia inválido no mês destino (ex: 31 de fevereiro) → último dia do mês
            import calendar
            ultimo = calendar.monthrange(ano, mes)[1]
            venc = date(ano, mes, ultimo)
        venc = proximo_dia_util(venc, uf)
    else:
        raise ValueError(f"tipo deve ser 'uteis', 'corridos' ou 'meses', não '{tipo}'")

    return venc


def dias_uteis_ate(hoje: date, vencimento: date, uf: Optional[str] = None) -> int:
    """
    Conta quantos dias úteis restam de 'hoje' até 'vencimento' (inclusive).
    Retorna negativo se já vencido.
    """
    cache: dict[int, set[date]] = {}
    sinal = 1 if vencimento >= hoje else -1
    inicio = min(hoje, vencimento)
    fim = max(hoje, vencimento)
    contados = 0
    d = inicio
    while d <= fim:
        if d.weekday() < 5 and not _is_feriado(d, cache, uf):
            contados += 1
        d += timedelta(days=1)
    # O dia de hoje não conta
    contados = max(0, contados - 1)
    return sinal * contados
