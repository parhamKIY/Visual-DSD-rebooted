namespace VisualDsd.Engine

open System
open System.Collections.Generic
open Microsoft.Research.CRNEngine
open VisualDsd.Contracts

module internal LiveProgress =
    let phase phase message = EngineTelemetry.Report(EngineProgress(phase,message),true)
    let run (crn:Crn) (instance:Instance<Functional>) =
        let name=(if String.IsNullOrEmpty instance.settings.name then instance.name else instance.settings.name)
        EngineTelemetry.Report(EngineProgress("simulating","Running simulation.",Run=name),true)
        let names=instance.settings.plots |> List.truncate 8 |> List.map Functional2.to_string_plot |> List.toArray
        let rows=Queue<float*float[]>()
        fun (row:Row<float>) ->
            if EngineTelemetry.Active && row.values.Length>=names.Length && Double.IsFinite row.time then
                let values=row.values |> Array.truncate names.Length
                if values |> Array.forall Double.IsFinite then
                    rows.Enqueue(row.time,values)
                    if rows.Count>200 then rows.Dequeue() |> ignore
                    if rows.Count=1 || EngineTelemetry.Ready then
                        let samples=rows.ToArray()
                        let preview=ObservationData(samples |> Array.map fst,names |> Array.mapi(fun i name -> SeriesData(name,samples |> Array.map(fun (_,values)->values.[i]))))
                        EngineTelemetry.Report(EngineProgress("simulating","Live preview: latest 200 solver rows, first 8 plots; provisional until completion.",Run=name,Time=Nullable row.time,Preview=preview),rows.Count=1)
