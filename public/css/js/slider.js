let index=0

function startSlider(){

const slides=document.querySelectorAll(".slide")

function show(){

slides.forEach(s=>{
s.style.display="none"
})

slides[index].style.display="block"

index++

if(index>=slides.length){
index=0
}

}

setInterval(show,2000)

show()

}

startSlider()