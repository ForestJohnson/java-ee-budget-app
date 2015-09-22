package restart.data;

import javax.ejb.Stateless;
import javax.enterprise.inject.Default;
import org.iq80.leveldb.*;
import static org.iq80.leveldb.impl.Iq80DBFactory.*;
import java.io.*;
import java.util.function.BiFunction;
import java.util.function.Function;

@Stateless
@Default
public class LevelDB implements ILevelDB {

	  private DB db;
	  
	  public LevelDB () throws IOException {
	    Options options = new Options();
	    options.createIfMissing(true);
	    this.db = factory.open(new File("testLevelDb"), options);
	    System.out.println("The DB is open.");
	  }

	  public <R> R snapshot(BiFunction<DB, ReadOptions, R> action) throws IOException {
	    ReadOptions readOptions = new ReadOptions();
	    readOptions.snapshot(db.getSnapshot());
	    try {
	      return action.apply(db, readOptions);
	    } finally {
	      // Make sure you close the snapshot to avoid resource leaks.
	      readOptions.snapshot().close();
	    }
	  }

	  public <R> R atomicWrite(Function<WriteBatch, R> action) throws IOException {
	    WriteBatch batch = db.createWriteBatch();
	    R result = action.apply(batch);
	    try {
	    } finally {
	      db.write(batch);
	      
	      // Make sure you close the batch to avoid resource leaks.
	      batch.close();
	    }
	    return result;
	  }

	  public <R> R withIterator(DB db, ReadOptions readOptions, Function<DBIterator, R> action) throws IOException {
	    DBIterator iterator;
	    if(readOptions == null) {
	      iterator = db.iterator();
	    } else {
	      iterator = db.iterator(readOptions);
	    }
	    try {
	      return action.apply(iterator);
	    } finally {
	      // Make sure you close the iterator to avoid resource leaks.
	      iterator.close();
	    }
	  }
	  
	  @Override
	  public void close() throws Exception {
	    db.close();
	    System.out.println("The DB is closed.");
	  }

}


