 #include <LiquidCrystal.h>
 

//LDCD Display
LiquidCrystal lcd(9, 8, 6, 5, 4, 3);  //Digitale Pins an dem das Display angeschlossen ist
#define LCD_WIDTH 16                    //Anzahl Spalten des Display (16)
#define LCD_HEIGHT 2                    //Anzahl Zeilen des Display (2)
 

 
#define DEBUG_MODE true                 //Debug Modus gibt Werte im Terminal aus (Serial)
//Bis hier anpassen
 
void setup(void)
{
  Serial.begin(9600);  
  byte i;
 
  lcd.begin(LCD_WIDTH, LCD_HEIGHT,1);
 
  lcd.setCursor(0,0);
  lcd.print("StatTrak");
  //delay(1000);
  //Serial.println("Arduino connected.");
  //lcd.clear();
 
}

void loop() {
  // when characters arrive over the serial port...
  if (Serial.available()) {
    int killCount = 0;
    // wait a bit for the entire message to arrive
    delay(100);
    //clear display for new killcount
    lcd.clear();
    // read all the available characters
    while (Serial.available() > 0) {
      // write each character to display as ascii
      killCount = (int)Serial.read();
      lcd.write((char)killCount+48);
    
      Serial.println(killCount);
    } 
  }
}
