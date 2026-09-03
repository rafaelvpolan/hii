1. **Cenario:** readReportedCost(undefined)
   - **Entrada/Condicao:** undefined
   - **Comportamento Esperado:** { cost: 0, costMeasured: false }

2. **Cenario:** readReportedCost(NaN)
   - **Entrada/Condicao:** NaN
   - **Comportamento Esperado:** { cost: 0, costMeasured: false }

3. **Cenario:** readReportedCost(-Infinity)
   - **Entrada/Condicao:** -Infinity
   - **Comportamento Esperado:** { cost: 0, costMeasured: false }

4. **Cenario:** readReportedCost(Infinity)
   - **Entrada/Condicao:** Infinity
   - **Comportamento Esperado:** { cost: 0, costMeasured: false }

5. **Cenario:** readReportedCost(123)
   - **Entrada/Condicao:** 123
   - **Comportamento Esperado:** { cost: 123, costMeasured: true }

6. **Cenario:** readReportedCost(0)
   - **Entrada/Condicao:** 0
   - **Comportamento Esperado:** { cost: 0, costMeasured: true }

7. **Cenario:** readReportedCost(-123)
   - **Entrada/Condicao:** -123
   - **Comportamento Esperado:** { cost: 0, costMeasured: false } [VERIFICAR]

8. **Cenario:** readReportedCost(123.456)
   - **Entrada/Condicao:** 123.456
   - **Comportamento Esperado:** { cost: 123, costMeasured: true }